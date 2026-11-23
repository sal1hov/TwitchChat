using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace TwitchChat;

/// <summary>Runs the same Node.js chat backend used by the Electron build.</summary>
public sealed class NodeHost : IAsyncDisposable
{
    private readonly Process _process;
    private readonly StreamWriter _input;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private long _nextId;
    private int _disposed;

    private NodeHost(Process process)
    {
        _process = process;
        _input = process.StandardInput;
        _process.OutputDataReceived += OnOutput;
        _process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data)) Trace.WriteLine("[TwitchChat Node] " + e.Data);
        };
        _process.Exited += (_, _) =>
        {
            var error = new InvalidOperationException("Сервис TwitchChat неожиданно завершился.");
            _ready.TrySetException(error);
            foreach (var entry in _pending.Values) entry.TrySetException(error);
        };
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
    }

    public static async Task<NodeHost> StartAsync(string settingsPath, CancellationToken cancellationToken = default)
    {
        var root = AppContext.BaseDirectory;
        var bundledNode = Path.Combine(root, "runtime", "node.exe");
        var nodeExecutable = File.Exists(bundledNode) ? bundledNode : "node";
        var serverScript = Path.Combine(root, "server.js");
        if (!File.Exists(serverScript))
            throw new FileNotFoundException("Не найден общий сервер server.js.", serverScript);

        var startInfo = new ProcessStartInfo
        {
            FileName = nodeExecutable,
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false)
        };
        startInfo.ArgumentList.Add(serverScript);
        startInfo.ArgumentList.Add("--desktop-host");
        startInfo.Environment["TWITCHCHAT_SETTINGS_PATH"] = settingsPath;

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        try
        {
            if (!process.Start()) throw new InvalidOperationException("Не удалось запустить Node.js.");
        }
        catch (Exception ex)
        {
            process.Dispose();
            throw new InvalidOperationException("Не удалось запустить встроенный Node.js. Проверь runtime\\node.exe.", ex);
        }

        var host = new NodeHost(process);
        try
        {
            await host._ready.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
            return host;
        }
        catch
        {
            await host.DisposeAsync();
            throw;
        }
    }

    private void OnOutput(object? sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(e.Data)) return;
        try
        {
            using var document = JsonDocument.Parse(e.Data);
            var root = document.RootElement;
            if (root.TryGetProperty("type", out var type) && type.GetString() == "ready")
            {
                _ready.TrySetResult();
                return;
            }

            if (!root.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String) return;
            var id = idElement.GetString();
            if (string.IsNullOrEmpty(id) || !_pending.TryRemove(id, out var completion)) return;

            if (root.TryGetProperty("error", out var errorElement))
                completion.TrySetException(new InvalidOperationException(errorElement.GetString() ?? "Ошибка Node.js"));
            else if (root.TryGetProperty("result", out var resultElement))
                completion.TrySetResult(resultElement.Clone());
            else
            {
                using var nullDocument = JsonDocument.Parse("null");
                completion.TrySetResult(nullDocument.RootElement.Clone());
            }
        }
        catch (Exception ex)
        {
            Trace.WriteLine("[TwitchChat Node protocol] " + ex.Message);
        }
    }

    public Task<JsonElement> CallAsync(string method, object? args = null, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return SendAsync(method, args, TimeSpan.FromSeconds(90), cancellationToken);
    }

    private async Task<JsonElement> SendAsync(string method, object? args, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (_process.HasExited) throw new InvalidOperationException("Сервис TwitchChat не запущен.");

        var id = Interlocked.Increment(ref _nextId).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, completion)) throw new InvalidOperationException("Не удалось создать запрос к серверу.");

        try
        {
            var line = JsonSerializer.Serialize(new { id, method, args });
            await _writeLock.WaitAsync(cancellationToken);
            try
            {
                await _input.WriteLineAsync(line);
                await _input.FlushAsync(cancellationToken);
            }
            finally
            {
                _writeLock.Release();
            }
            return await completion.Task.WaitAsync(timeout, cancellationToken);
        }
        catch
        {
            _pending.TryRemove(id, out _);
            throw;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        try
        {
            if (!_process.HasExited)
            {
                // Ask the backend to stop first, wait for its acknowledgement, then close stdin.
                // Closing stdin triggers the Node host's final exit path.
                await SendAsync("shutdown", new { }, TimeSpan.FromSeconds(12), CancellationToken.None);
                _input.Close();
                await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
            }
        }
        catch (Exception ex)
        {
            Trace.WriteLine("[TwitchChat Node shutdown] " + ex.Message);
            try { if (!_process.HasExited) _process.Kill(entireProcessTree: true); } catch { }
        }
        finally
        {
            try { _input.Dispose(); } catch { }
            _process.Dispose();
            _writeLock.Dispose();
        }
    }
}

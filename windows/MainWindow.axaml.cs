
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input.Platform;
using Avalonia.Platform;

namespace TwitchChat;

public partial class MainWindow : Window
{
    private NodeHost? _node;

    private readonly string _settingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "TwitchChat",
        "settings.json");

    private int _hostDisposed;

    public string ObsUrl { get; private set; } = "";

    private const uint WM_NCLBUTTONDOWN = 0x00A1;
    private static readonly IntPtr HTCAPTION = new IntPtr(2);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(
        IntPtr hWnd,
        uint msg,
        IntPtr wParam,
        IntPtr lParam);

    public MainWindow()
    {
        InitializeComponent();

        try
        {
            Icon = new WindowIcon(
                AssetLoader.Open(new Uri("avares://TwitchChat/Assets/icon.png")));
        }
        catch (Exception ex)
        {
            Trace.WriteLine("TwitchChat window icon: " + ex.Message);
        }

        Browser.WebMessageReceived += Browser_WebMessageReceived;
        Browser.NavigationCompleted += Browser_NavigationCompleted;

        Browser.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;

            var uri = e.Request;

            if (uri != null &&
                (uri.Scheme == Uri.UriSchemeHttp ||
                 uri.Scheme == Uri.UriSchemeHttps))
            {
                OpenExternal(uri.ToString());
            }
        };

        Browser.NavigationStarted += (_, e) =>
        {
            var uri = e.Request;

            if (uri != null &&
                (uri.Scheme == Uri.UriSchemeHttp ||
                 uri.Scheme == Uri.UriSchemeHttps))
            {
                e.Cancel = true;
                OpenExternal(uri.ToString());
            }
        };

        Opened += async (_, _) => await InitializeHostAsync();
    }

    private void StartWindowDrag()
    {
        if (!OperatingSystem.IsWindows())
            return;

        try
        {
            var handle = TryGetPlatformHandle();

            if (handle == null)
                return;

            ReleaseCapture();

            SendMessage(
                handle.Handle,
                WM_NCLBUTTONDOWN,
                HTCAPTION,
                IntPtr.Zero);
        }
        catch (Exception ex)
        {
            Trace.WriteLine("TwitchChat window drag error: " + ex);
        }
    }

    private async Task InitializeHostAsync()
    {
        try
        {
            Directory.CreateDirectory(
                Path.GetDirectoryName(_settingsPath)!);

            _node = await NodeHost.StartAsync(_settingsPath);

            var pagePath = Path.GetFullPath(
                Path.Combine(AppContext.BaseDirectory, "app.html"));

            if (!File.Exists(pagePath))
            {
                throw new FileNotFoundException(
                    "Не найден файл интерфейса app.html.",
                    pagePath);
            }

            var pageUri = new UriBuilder(new Uri(pagePath))
            {
                Query = "host=avalonia"
            }.Uri;

            Browser.Source = pageUri;
        }
        catch (Exception ex)
        {
            Trace.WriteLine("TwitchChat initialization error: " + ex);

            var html =
                "<!doctype html><html lang='ru'><meta charset='utf-8'>" +
                "<body style='background:#0d0b18;color:#fff;" +
                "font:16px Segoe UI;padding:32px'>" +
                "<h2>Не удалось запустить TwitchChat</h2><p>" +
                System.Net.WebUtility.HtmlEncode(ex.Message) +
                "</p><p>Проверь runtime\\node.exe, папку node_modules " +
                "и файлы сервера в каталоге приложения.</p></body></html>";

            Browser.NavigateToString(html, new Uri("about:blank"));
        }
    }

    private void Browser_NavigationCompleted(
        object? sender,
        WebViewNavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            Trace.WriteLine(
                "TwitchChat WebView: загрузка app.html завершилась ошибкой: " +
                e.Request);
        }
    }

    private async void Browser_WebMessageReceived(
        object? sender,
        WebMessageReceivedEventArgs e)
    {
        string? id = null;

        if (string.IsNullOrWhiteSpace(e.Body))
        {
            Trace.WriteLine("TwitchChat WebView: получено пустое сообщение.");
            return;
        }

        try
        {
            using var requestDoc = JsonDocument.Parse(e.Body);

            var request = requestDoc.RootElement;

            id = request.TryGetProperty("id", out var idValue) &&
                 idValue.ValueKind == JsonValueKind.String
                ? idValue.GetString()
                : null;

            var method =
                request.TryGetProperty("method", out var methodValue) &&
                methodValue.ValueKind == JsonValueKind.String
                    ? methodValue.GetString()
                    : null;

            var args = request.TryGetProperty("args", out var argsValue)
                ? argsValue.Clone()
                : default;

            var result = await HandleApiCallAsync(method ?? "", args);

            await ResolveWebCallAsync(id, result, null);
        }
        catch (Exception ex)
        {
            Trace.WriteLine("TwitchChat WebView API error: " + ex);

            await ResolveWebCallAsync(id, null, ex.Message);
        }
    }

    private async Task<object?> HandleApiCallAsync(
        string method,
        JsonElement args)
    {
        static string ReadString(JsonElement value, string key)
        {
            return value.ValueKind == JsonValueKind.Object &&
                   value.TryGetProperty(key, out var item) &&
                   item.ValueKind == JsonValueKind.String
                ? item.GetString() ?? ""
                : "";
        }

        switch (method)
        {
            case "minimizeWindow":
                WindowState = WindowState.Minimized;
                return true;

            case "closeWindow":
                Hide();
                return true;

            case "startWindowDrag":
                StartWindowDrag();
                return true;

            case "quit":
                await App.QuitAsync();
                return true;

            case "copy":
            {
                var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;

                if (clipboard != null)
                    await clipboard.SetTextAsync(ReadString(args, "text"));

                return true;
            }

            case "openAuthor":
                OpenExternal("https://github.com/strdns");
                return true;

            case "openAuthorFork":
                OpenExternal("https://github.com/sal1hov");
                return true;

            case "version":
                return typeof(MainWindow).Assembly
                    .GetName().Version?.ToString(3) ?? "0.1.1";

            case "getChannel":
            case "getAppearance":
            case "setAppearance":
            case "start":
            case "stop":
            {
                if (_node == null)
                {
                    throw new InvalidOperationException(
                        "Сервис TwitchChat ещё запускается.");
                }

                object nodeArgs;

                if (method == "start")
                {
                    nodeArgs = new
                    {
                        channel = ReadString(args, "channel")
                    };
                }
                else if (method == "setAppearance")
                {
                    var parameters =
                        args.ValueKind == JsonValueKind.Object &&
                        args.TryGetProperty("params", out var value)
                            ? value.Clone()
                            : EmptyObject();

                    nodeArgs = new Dictionary<string, object?>
                    {
                        ["params"] = parameters
                    };
                }
                else
                {
                    nodeArgs = new { };
                }

                var response = await _node.CallAsync(method, nodeArgs);

                if (method == "start" &&
                    response.ValueKind == JsonValueKind.Object &&
                    response.TryGetProperty("url", out var url) &&
                    url.ValueKind == JsonValueKind.String)
                {
                    ObsUrl = url.GetString() ?? ObsUrl;
                }

                if (method == "stop")
                    ObsUrl = "";

                return response;
            }

            default:
                throw new InvalidOperationException(
                    "Неизвестный запрос интерфейса: " + method);
        }
    }

    private static JsonElement EmptyObject()
    {
        using var document = JsonDocument.Parse("{}");

        return document.RootElement.Clone();
    }

    private async Task ResolveWebCallAsync(
        string? id,
        object? result,
        string? error)
    {
        if (string.IsNullOrEmpty(id))
            return;

        var idJson = JsonSerializer.Serialize(id);
        var resultJson = JsonSerializer.Serialize(result);
        var errorJson = JsonSerializer.Serialize(error);

        var script =
            $"window.__twitchchatResolve && " +
            $"window.__twitchchatResolve({idJson}, " +
            $"{resultJson}, {errorJson});";

        try
        {
            await Browser.InvokeScript(script);
        }
        catch (Exception ex)
        {
            Trace.WriteLine(
                "TwitchChat WebView bridge: " + ex.Message);
        }
    }

    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return;

        if (uri.Scheme != Uri.UriSchemeHttp &&
            uri.Scheme != Uri.UriSchemeHttps)
            return;

        try
        {
            Process.Start(new ProcessStartInfo(uri.ToString())
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Trace.WriteLine(
                "TwitchChat external link error: " + ex.Message);
        }
    }

    public async Task ShutdownNodeHostAsync()
    {
        if (Interlocked.Exchange(ref _hostDisposed, 1) != 0)
            return;

        var host = _node;
        _node = null;

        if (host != null)
            await host.DisposeAsync();
    }

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        if (!App.Quitting)
        {
            e.Cancel = true;
            Hide();
            return;
        }

        base.OnClosing(e);
    }

    protected override void OnClosed(EventArgs e)
    {
        if (_node != null &&
            Volatile.Read(ref _hostDisposed) == 0)
        {
            _ = ShutdownNodeHostAsync();
        }

        base.OnClosed(e);
    }
}

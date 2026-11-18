using System.Net.Security;
using System.Net.Sockets;
using System.Text;

namespace ChatServer;

sealed class TwitchIrc : IAsyncDisposable
{
    public event Action? Connected;
    public event Action<string>? Dropped;
    public event Action<IrcLine>? PrivMsg;
    public event Action<IrcLine>? UserNotice;

    readonly string _channel;
    readonly CancellationTokenSource _stop = new();
    int _stopped;

    public TwitchIrc(string channel) => _channel = channel;

    public Task RunAsync() => Task.Run(() => Loop(_stop.Token));

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _stopped, 1) == 1) return;
        _stop.Cancel();
        await Task.CompletedTask;
    }

    async Task Loop(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            try
            {
                await Session(cancel);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                if (cancel.IsCancellationRequested) break;
                Dropped?.Invoke(ex.Message);
            }

            try { await Task.Delay(2000, cancel); }
            catch { break; }
        }
    }

    async Task Session(CancellationToken cancel)
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync("irc.chat.twitch.tv", 6697, cancel);
        await using var ssl = new SslStream(tcp.GetStream(), false);
        await ssl.AuthenticateAsClientAsync("irc.chat.twitch.tv");

        var nick = "justinfan" + Random.Shared.Next(10000, 99999);
        await Send(ssl, "CAP REQ :twitch.tv/tags twitch.tv/commands", cancel);
        await Send(ssl, "PASS SCHMOOPIIE", cancel);
        await Send(ssl, "NICK " + nick, cancel);

        var buffer = new byte[8192];
        var pending = new StringBuilder();
        var joined = false;

        while (!cancel.IsCancellationRequested)
        {
            var read = await ssl.ReadAsync(buffer, cancel);
            if (read == 0) throw new IOException("соединение закрыто");
            pending.Append(Encoding.UTF8.GetString(buffer, 0, read));

            while (true)
            {
                var text = pending.ToString();
                var end = text.IndexOf("\r\n", StringComparison.Ordinal);
                if (end < 0) break;
                var raw = text[..end];
                pending.Remove(0, end + 2);
                var line = Parse(raw);
                if (line.Command.Equals("PING", StringComparison.OrdinalIgnoreCase))
                {
                    await Send(ssl, "PONG :" + line.Trailing, cancel);
                    continue;
                }
                if (!joined && line.Command == "001")
                {
                    joined = true;
                    await Send(ssl, "JOIN #" + _channel, cancel);
                    Connected?.Invoke();
                    continue;
                }
                if (line.Command.Equals("PRIVMSG", StringComparison.OrdinalIgnoreCase)) PrivMsg?.Invoke(line);
                else if (line.Command.Equals("USERNOTICE", StringComparison.OrdinalIgnoreCase)) UserNotice?.Invoke(line);
            }
        }
    }

    static async Task Send(Stream stream, string line, CancellationToken cancel)
    {
        var data = Encoding.UTF8.GetBytes(line + "\r\n");
        await stream.WriteAsync(data, cancel);
        await stream.FlushAsync(cancel);
    }

    static IrcLine Parse(string raw)
    {
        var tags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var rest = raw;
        if (rest.StartsWith('@'))
        {
            var space = rest.IndexOf(' ');
            var blob = space < 0 ? rest[1..] : rest[1..space];
            rest = space < 0 ? "" : rest[(space + 1)..];
            foreach (var piece in blob.Split(';'))
            {
                if (piece.Length == 0) continue;
                var eq = piece.IndexOf('=');
                if (eq < 0) tags[piece] = "";
                else tags[piece[..eq]] = Unescape(piece[(eq + 1)..]);
            }
        }

        var prefix = "";
        if (rest.StartsWith(':'))
        {
            var space = rest.IndexOf(' ');
            prefix = space < 0 ? rest[1..] : rest[1..space];
            rest = space < 0 ? "" : rest[(space + 1)..];
        }

        var commandSpace = rest.IndexOf(' ');
        var command = commandSpace < 0 ? rest : rest[..commandSpace];
        var trailing = "";
        if (commandSpace >= 0)
        {
            var args = rest[(commandSpace + 1)..];
            var colon = args.IndexOf(" :", StringComparison.Ordinal);
            if (args.StartsWith(':')) trailing = args[1..];
            else if (colon >= 0) trailing = args[(colon + 2)..];
        }

        var nick = prefix;
        var bang = nick.IndexOf('!');
        if (bang >= 0) nick = nick[..bang];
        return new IrcLine(command, nick, trailing, tags);
    }

    static string Unescape(string value)
    {
        var builder = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] == '\\' && i + 1 < value.Length)
            {
                var next = value[++i];
                builder.Append(next switch
                {
                    ':' => ';',
                    's' => ' ',
                    '\\' => '\\',
                    'r' => '\r',
                    'n' => '\n',
                    _ => next
                });
            }
            else builder.Append(value[i]);
        }
        return builder.ToString();
    }
}

sealed record IrcLine(string Command, string Nick, string Trailing, Dictionary<string, string> Tags);

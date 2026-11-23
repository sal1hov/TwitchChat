using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TwitchChat;

public sealed class StartResult
{
    public bool Ok { get; init; }
    public string Url { get; init; } = "";
    public string Channel { get; init; } = "";
    public string? Error { get; init; }
}

public sealed class ChatSession : IDisposable
{
    const int Port = 3000;
    const int MaxMessages = 50;

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    static readonly string[] NickColors =
    [
        "#FF0000", "#0000FF", "#008000", "#B22222", "#FF7F50",
        "#9ACD32", "#FF4500", "#2E8B57", "#DAA520", "#D2691E",
        "#5F9EA0", "#1E90FF", "#FF69B4", "#8A2BE2", "#00FF7F"
    ];

    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(90) };

    readonly object _gate = new();
    readonly List<WebSocket> _clients = new();
    readonly List<ChatMessage> _history = new();
    readonly string _publicDir;
    readonly string _settingsPath;

    HttpListener? _listener;
    CancellationTokenSource? _httpStop;
    TwitchIrc? _irc;
    Timer? _refresh;
    string _channel = "";
    bool _ircUp;
    string _ircProblem = "";
    List<string> _assetProblems = new();
    string _statusLevel = "wait";
    string _statusText = "подключаюсь к чату";
    Dictionary<string, string> _emotes = new(StringComparer.Ordinal);
    Dictionary<string, Badge> _badges = new(StringComparer.Ordinal);
    bool _loading;
    int _disposed;

    public string Url => "http://localhost:" + Port;

    public ChatSession()
    {
        _publicDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "public"));
        _settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "TwitchChat",
            "settings.json");
    }

    public string ReadChannel()
    {
        try
        {
            var data = JsonSerializer.Deserialize<Settings>(File.ReadAllText(_settingsPath), Json);
            return data?.Channel ?? "";
        }
        catch
        {
            return "";
        }
    }

    public async Task<StartResult> StartAsync(string input)
    {
        string next;
        try
        {
            next = Normalize(input);
        }
        catch (Exception ex)
        {
            return new StartResult { Ok = false, Error = ex.Message };
        }

        try
        {
            await EnsureListening();
        }
        catch (Exception ex)
        {
            var busy = ex is HttpListenerException;
            return new StartResult
            {
                Ok = false,
                Error = busy ? "Порт " + Port + " уже занят" : ex.Message
            };
        }

        await StopIrc();
        _channel = next;
        _ircUp = false;
        _ircProblem = "";
        _assetProblems = new();
        Clear();
        _refresh ??= new Timer(_ => _ = LoadAssets(), null, TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(10));
        await LoadAssets();

        var connected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var irc = new TwitchIrc(next);
        irc.Connected += () =>
        {
            _ircUp = true;
            _ircProblem = "";
            PublishStatus();
            connected.TrySetResult();
        };
        irc.Dropped += reason =>
        {
            _ircUp = false;
            _ircProblem = string.IsNullOrEmpty(reason) ? "чат отвалился" : "чат отвалился: " + reason;
            PublishStatus();
        };
        irc.PrivMsg += OnPrivMsg;
        irc.UserNotice += OnUserNotice;
        _irc = irc;
        _ = irc.RunAsync();
        var finished = await Task.WhenAny(connected.Task, Task.Delay(20000));
        if (finished != connected.Task)
        {
            _ircProblem = "чат не подключился";
            PublishStatus();
            return new StartResult { Ok = false, Url = Url, Channel = next, Error = _ircProblem };
        }

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_settingsPath)!);
            File.WriteAllText(_settingsPath, JsonSerializer.Serialize(new Settings { Channel = next }, Json));
        }
        catch { }

        return new StartResult { Ok = true, Url = Url, Channel = next };
    }

    public async Task StopAsync()
    {
        _ircUp = false;
        _ircProblem = "";
        await StopIrc();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1) return;
        _refresh?.Dispose();
        _httpStop?.Cancel();
        try { _listener?.Stop(); } catch { }
        _ = StopIrc();
    }

    async Task StopIrc()
    {
        var irc = _irc;
        _irc = null;
        if (irc != null) await irc.DisposeAsync();
    }

    Task EnsureListening()
    {
        if (_listener != null && _listener.IsListening) return Task.CompletedTask;
        var listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:" + Port + "/");
        listener.Start();
        _listener = listener;
        _httpStop = new CancellationTokenSource();
        _ = AcceptLoop(listener, _httpStop.Token);
        return Task.CompletedTask;
    }

    async Task AcceptLoop(HttpListener listener, CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync(); }
            catch { break; }
            _ = Task.Run(() => Handle(context));
        }
    }

    async Task Handle(HttpListenerContext context)
    {
        try
        {
            if (context.Request.IsWebSocketRequest)
            {
                var socket = (await context.AcceptWebSocketAsync(null)).WebSocket;
                lock (_gate) _clients.Add(socket);
                await Send(socket, new { type = "hello", maxMessages = MaxMessages, history = Snapshot() });
                var buffer = new byte[64];
                try
                {
                    while (socket.State == WebSocketState.Open)
                    {
                        var result = await socket.ReceiveAsync(buffer, CancellationToken.None);
                        if (result.MessageType == WebSocketMessageType.Close) break;
                    }
                }
                catch { }
                lock (_gate) _clients.Remove(socket);
                return;
            }

            var relative = Uri.UnescapeDataString(context.Request.Url?.AbsolutePath ?? "/").TrimStart('/');
            if (relative.Length == 0) relative = "index.html";
            relative = relative.Replace('\\', '/');
            if (relative.Contains("..", StringComparison.Ordinal))
            {
                context.Response.StatusCode = 400;
                context.Response.Close();
                return;
            }

            var full = Path.GetFullPath(Path.Combine(_publicDir, relative));
            var root = _publicDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.Ordinal) || !File.Exists(full))
            {
                context.Response.StatusCode = 404;
                context.Response.Close();
                return;
            }

            var bytes = await File.ReadAllBytesAsync(full);
            context.Response.ContentType = ContentType(full);
            context.Response.Headers["Cache-Control"] = "no-store";
            context.Response.ContentLength64 = bytes.Length;
            await context.Response.OutputStream.WriteAsync(bytes);
            context.Response.Close();
        }
        catch
        {
            try { context.Response.Abort(); } catch { }
        }
    }

    static string ContentType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".png" => "image/png",
            ".svg" => "image/svg+xml",
            ".webp" => "image/webp",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            _ => "application/octet-stream"
        };
    }

    void OnPrivMsg(IrcLine line)
    {
        var text = line.Trailing;
        var action = false;
        if (text.StartsWith("\u0001ACTION ", StringComparison.Ordinal) && text.EndsWith('\u0001'))
        {
            action = true;
            text = text[8..^1];
        }
        EmitUser(line.Tags, line.Nick, ParseParts(text, Tag(line.Tags, "emotes")), new Extra
        {
            Action = action,
            Flags = FlagsOf(line.Tags),
            Reply = ReplyOf(line.Tags)
        });
    }

    void OnUserNotice(IrcLine line)
    {
        var id = Tag(line.Tags, "msg-id");
        var tags = line.Tags;
        switch (id)
        {
            case "sub":
                EmitUser(tags, line.Nick, WithMessage(JoinBits("подписка", Tier(tags)), line.Trailing, Tag(tags, "emotes")));
                break;
            case "resub":
                var months = Number(Tag(tags, "msg-param-cumulative-months"));
                var label = JoinBits(months > 0 ? months + " мес." : "", Tier(tags));
                if (label.Length == 0) label = "ресуб";
                EmitUser(tags, line.Nick, WithMessage(label, line.Trailing, Tag(tags, "emotes")));
                break;
            case "subgift":
                EmitUser(tags, line.Nick, TextParts(JoinBits("подарок", Tag(tags, "msg-param-recipient-display-name"), Tier(tags))));
                break;
            case "anonsubgift":
                EmitUser(tags, "Аноним", TextParts(JoinBits("подарок", Tag(tags, "msg-param-recipient-display-name"), Tier(tags))), "Аноним");
                break;
            case "submysterygift":
                EmitUser(tags, line.Nick, TextParts(JoinBits(Gifted(Number(Tag(tags, "msg-param-mass-gift-count"))), Tier(tags))));
                break;
            case "anonsubmysterygift":
                EmitUser(tags, "Аноним", TextParts(JoinBits(Gifted(Number(Tag(tags, "msg-param-mass-gift-count"))), Tier(tags))), "Аноним");
                break;
            case "giftpaidupgrade":
                var sender = Tag(tags, "msg-param-sender-name");
                if (sender.Length == 0) sender = Tag(tags, "msg-param-sender-login");
                EmitUser(tags, line.Nick, TextParts(sender.Length == 0 ? "подарок продлён" : "подарок от " + sender + " продлён"));
                break;
            case "anongiftpaidupgrade":
                EmitUser(tags, line.Nick, TextParts("анонимный подарок продлён"));
                break;
            case "primepaidupgrade":
                var tier = Tier(tags);
                EmitUser(tags, line.Nick, TextParts("Prime → " + (tier.Length == 0 ? "платная" : tier)));
                break;
            case "raid":
                var user = Person(tags, line.Nick);
                Emit(new ChatMessage
                {
                    DisplayName = line.Nick.Length == 0 ? user.Name : line.Nick,
                    Color = user.Color,
                    Badges = user.Badges,
                    Flags = new List<string> { "рейд" },
                    Parts = TextParts(Viewers(Number(Tag(tags, "msg-param-viewerCount"))))
                });
                break;
            case "announcement":
                var flags = new List<string> { "объявление" };
                flags.AddRange(FlagsOf(tags));
                EmitUser(tags, line.Nick, ParseParts(line.Trailing, Tag(tags, "emotes")), new Extra { Flags = flags });
                break;
        }
    }

    async Task LoadAssets()
    {
        if (_loading || _channel.Length == 0) return;
        _loading = true;
        var emotes = new Dictionary<string, string>(StringComparer.Ordinal);
        var badges = new Dictionary<string, Badge>(StringComparer.Ordinal);
        var failed = new List<string>();
        try
        {
            var twitchId = "";
            await Attempt("twitch user", async () =>
            {
                using var doc = await GetJson("https://api.ivr.fi/v2/twitch/user?login=" + Uri.EscapeDataString(_channel));
                if (doc.RootElement.GetArrayLength() == 0 || !doc.RootElement[0].TryGetProperty("id", out var id))
                    throw new Exception("канал не найден");
                twitchId = id.GetString() ?? "";
                if (twitchId.Length == 0) throw new Exception("канал не найден");
            }, failed);
            await Attempt("bttv global", async () =>
            {
                using var doc = await GetJson("https://api.betterttv.net/3/cached/emotes/global");
                AddBttv(doc.RootElement, emotes);
            }, failed);
            await Attempt("7tv global", async () =>
            {
                using var doc = await GetJson("https://7tv.io/v3/emote-sets/global");
                if (doc.RootElement.TryGetProperty("emotes", out var list)) Add7tv(list, emotes);
            }, failed);
            await Attempt("ffz global", async () =>
            {
                using var doc = await GetJson("https://api.betterttv.net/3/cached/frankerfacez/emotes/global");
                AddFfz(doc.RootElement, emotes);
            }, failed);
            await Attempt("badges global", async () =>
            {
                using var doc = await GetJson("https://api.ivr.fi/v2/twitch/badges/global");
                AddBadges(doc.RootElement, badges);
            }, failed);

            if (twitchId.Length > 0)
            {
                await Attempt("bttv channel", async () =>
                {
                    using var doc = await GetJson("https://api.betterttv.net/3/cached/users/twitch/" + twitchId);
                    if (doc.RootElement.TryGetProperty("channelEmotes", out var channel)) AddBttv(channel, emotes);
                    if (doc.RootElement.TryGetProperty("sharedEmotes", out var shared)) AddBttv(shared, emotes);
                }, failed);
                await Attempt("7tv channel", async () =>
                {
                    using var doc = await GetJson("https://7tv.io/v3/users/twitch/" + twitchId);
                    if (doc.RootElement.TryGetProperty("emote_set", out var set) && set.ValueKind == JsonValueKind.Object && set.TryGetProperty("emotes", out var list))
                        Add7tv(list, emotes);
                }, failed);
                await Attempt("ffz channel", async () =>
                {
                    using var doc = await GetJson("https://api.betterttv.net/3/cached/frankerfacez/users/twitch/" + twitchId);
                    AddFfz(doc.RootElement, emotes);
                }, failed);
                await Attempt("badges channel", async () =>
                {
                    using var doc = await GetJson("https://api.ivr.fi/v2/twitch/badges/channel?id=" + twitchId);
                    AddBadges(doc.RootElement, badges);
                }, failed);
            }

            _emotes = emotes;
            _badges = badges;
            _assetProblems = failed;
        }
        finally
        {
            _loading = false;
            PublishStatus();
        }
    }

    static async Task Attempt(string label, Func<Task> action, List<string> failed)
    {
        try { await action(); }
        catch { lock (failed) failed.Add(label); }
    }

    static async Task<JsonDocument> GetJson(string url)
    {
        Exception? last = null;
        for (var i = 0; i < 2; i++)
        {
            try
            {
                var body = await Http.GetStringAsync(url);
                return JsonDocument.Parse(body);
            }
            catch (Exception ex) { last = ex; }
        }
        throw last ?? new Exception(url);
    }

    static void AddBttv(JsonElement list, Dictionary<string, string> map)
    {
        if (list.ValueKind != JsonValueKind.Array) return;
        foreach (var emote in list.EnumerateArray())
        {
            var code = Str(emote, "code");
            var id = Str(emote, "id");
            if (code.Length == 0 || id.Length == 0) continue;
            map[code] = "https://cdn.betterttv.net/emote/" + id + "/2x";
        }
    }

    static void Add7tv(JsonElement list, Dictionary<string, string> map)
    {
        if (list.ValueKind != JsonValueKind.Array) return;
        foreach (var emote in list.EnumerateArray())
        {
            var name = Str(emote, "name");
            if (name.Length == 0 || !emote.TryGetProperty("data", out var data) || !data.TryGetProperty("host", out var host)) continue;
            var hostUrl = Str(host, "url");
            if (hostUrl.Length == 0 || !host.TryGetProperty("files", out var files) || files.ValueKind != JsonValueKind.Array) continue;
            var file = "";
            foreach (var item in files.EnumerateArray())
            {
                var itemName = Str(item, "name");
                if (itemName == "2x.webp") { file = itemName; break; }
                if (file.Length == 0 && itemName == "1x.webp") file = itemName;
            }
            if (file.Length == 0) continue;
            var baseUrl = hostUrl.StartsWith("http", StringComparison.Ordinal) ? hostUrl : "https:" + hostUrl;
            map[name] = baseUrl + "/" + file;
        }
    }

    static void AddFfz(JsonElement data, Dictionary<string, string> map)
    {
        if (data.ValueKind == JsonValueKind.Array) AddFfzList(data, map);
        else if (data.ValueKind == JsonValueKind.Object)
        {
            if (data.TryGetProperty("channelEmotes", out var channel)) AddFfzList(channel, map);
            if (data.TryGetProperty("sharedEmotes", out var shared)) AddFfzList(shared, map);
        }
    }

    static void AddFfzList(JsonElement list, Dictionary<string, string> map)
    {
        if (list.ValueKind != JsonValueKind.Array) return;
        foreach (var emote in list.EnumerateArray())
        {
            var code = Str(emote, "code");
            if (code.Length == 0 || !emote.TryGetProperty("images", out var images)) continue;
            var url = Str(images, "2x");
            if (url.Length == 0) url = Str(images, "1x");
            if (url.Length == 0) continue;
            map[code] = url;
        }
    }

    static void AddBadges(JsonElement list, Dictionary<string, Badge> map)
    {
        if (list.ValueKind != JsonValueKind.Array) return;
        foreach (var set in list.EnumerateArray())
        {
            var setId = Str(set, "set_id");
            if (setId.Length == 0 || !set.TryGetProperty("versions", out var versions)) continue;
            foreach (var version in versions.EnumerateArray())
            {
                var url = Str(version, "image_url_2x");
                if (url.Length == 0) url = Str(version, "image_url_1x");
                var id = Str(version, "id");
                if (url.Length == 0 || id.Length == 0) continue;
                var title = Str(version, "title");
                map[setId + "/" + id] = new Badge { Url = url, Title = title.Length == 0 ? setId : title };
            }
        }
    }

    List<Part> ParseParts(string text, string emoteTag)
    {
        var ranges = new List<(int Start, int End, string Id)>();
        if (emoteTag.Length > 0)
        {
            foreach (var group in emoteTag.Split('/'))
            {
                var colon = group.IndexOf(':');
                if (colon <= 0) continue;
                var id = group[..colon];
                foreach (var pos in group[(colon + 1)..].Split(','))
                {
                    var dash = pos.Split('-');
                    if (dash.Length != 2 || !int.TryParse(dash[0], out var start) || !int.TryParse(dash[1], out var end)) continue;
                    ranges.Add((start, end + 1, id));
                }
            }
        }
        ranges.Sort((a, b) => a.Start.CompareTo(b.Start));

        var parts = new List<Part>();
        var cursor = 0;
        foreach (var range in ranges)
        {
            if (range.Start < cursor || range.End > text.Length || range.Start >= range.End) continue;
            if (range.Start > cursor) parts.AddRange(ParseThirdParty(text[cursor..range.Start]));
            parts.Add(new Part
            {
                Type = "emote",
                Name = text[range.Start..range.End],
                Url = "https://static-cdn.jtvnw.net/emoticons/v2/" + range.Id + "/default/dark/2.0"
            });
            cursor = range.End;
        }
        if (cursor < text.Length) parts.AddRange(ParseThirdParty(text[cursor..]));
        return parts;
    }

    List<Part> ParseThirdParty(string text)
    {
        var parts = new List<Part>();
        foreach (var token in Regex.Split(text, @"(\s+)"))
        {
            if (token.Length == 0) continue;
            if (_emotes.TryGetValue(token, out var url)) parts.Add(new Part { Type = "emote", Name = token, Url = url });
            else parts.Add(new Part { Type = "text", Text = token });
        }
        return parts;
    }

    List<Part> WithMessage(string prefix, string message, string emotes)
    {
        var parts = new List<Part> { new() { Type = "text", Text = prefix } };
        if (message.Length > 0)
        {
            parts.Add(new Part { Type = "text", Text = " — " });
            parts.AddRange(ParseParts(message, emotes));
        }
        return parts;
    }

    static List<Part> TextParts(string text) => new() { new Part { Type = "text", Text = text } };

    void EmitUser(Dictionary<string, string> tags, string fallback, List<Part> parts, Extra? extra = null)
        => EmitUser(tags, fallback, parts, null, extra);

    void EmitUser(Dictionary<string, string> tags, string fallback, List<Part> parts, string? forceName, Extra? extra = null)
    {
        var user = Person(tags, fallback);
        Emit(new ChatMessage
        {
            DisplayName = forceName ?? user.Name,
            Color = user.Color,
            Badges = forceName == null ? user.Badges : new List<Badge>(),
            Action = extra?.Action ?? false,
            Flags = extra?.Flags ?? new List<string>(),
            Reply = extra?.Reply,
            Parts = parts
        });
    }

    void PublishStatus()
    {
        string level;
        string text;
        if (_ircProblem.Length > 0 || _assetProblems.Count > 0)
        {
            var bits = new List<string>();
            if (_ircProblem.Length > 0) bits.Add(_ircProblem);
            if (_assetProblems.Count > 0) bits.Add("не загрузилось: " + string.Join(", ", _assetProblems));
            level = "error";
            text = string.Join(" · ", bits);
        }
        else if (_ircUp)
        {
            level = "ok";
            text = "чат подключен";
        }
        else
        {
            level = "wait";
            text = "подключаюсь к чату";
        }

        if (level == _statusLevel && text == _statusText) return;
        _statusLevel = level;
        _statusText = text;
        if (level == "wait") return;
        Emit(new ChatMessage
        {
            Status = level,
            DisplayName = "",
            Parts = TextParts(text)
        });
    }

    void Clear()
    {
        lock (_gate) _history.Clear();
        _statusLevel = "wait";
        _statusText = "подключаюсь к чату";
        _ = Broadcast(new { type = "clear" });
    }

    void Emit(ChatMessage message)
    {
        message.Time = DateTime.Now.ToString("HH:mm");
        lock (_gate)
        {
            _history.Add(message);
            while (_history.Count > MaxMessages) _history.RemoveAt(0);
        }
        _ = Broadcast(new { type = "message", message });
    }

    List<ChatMessage> Snapshot()
    {
        lock (_gate) return _history.ToList();
    }

    async Task Broadcast(object payload)
    {
        var data = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json));
        List<WebSocket> clients;
        lock (_gate) clients = _clients.ToList();
        foreach (var socket in clients)
        {
            try
            {
                if (socket.State == WebSocketState.Open)
                    await socket.SendAsync(data, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch { }
        }
    }

    async Task Send(WebSocket socket, object payload)
    {
        var data = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json));
        await socket.SendAsync(data, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    (string Name, string Color, List<Badge> Badges) Person(Dictionary<string, string> tags, string fallback)
    {
        var login = Tag(tags, "login");
        if (login.Length == 0) login = fallback;
        var name = Tag(tags, "display-name");
        if (name.Length == 0) name = fallback.Length == 0 ? login : fallback;
        var color = Tag(tags, "color");
        if (color.Length == 0) color = DefaultColor(login.Length == 0 ? name : login);
        var badges = new List<Badge>();
        var raw = Tag(tags, "badges");
        if (raw.Length > 0)
        {
            foreach (var piece in raw.Split(','))
            {
                if (_badges.TryGetValue(piece, out var badge)) badges.Add(badge);
            }
        }
        return (name, color, badges);
    }

    static List<string> FlagsOf(Dictionary<string, string> tags)
    {
        var flags = new List<string>();
        if (Tag(tags, "first-msg") == "1") flags.Add("первый");
        if (Tag(tags, "msg-id") == "highlighted-message") flags.Add("хайлайт");
        return flags;
    }

    static Reply? ReplyOf(Dictionary<string, string> tags)
    {
        var name = Tag(tags, "reply-parent-display-name");
        if (name.Length == 0) return null;
        var text = Tag(tags, "reply-parent-msg-body");
        if (text.Length > 80) text = text[..80] + "…";
        return new Reply { Name = name, Text = text };
    }

    static string DefaultColor(string name)
    {
        var hash = 0;
        foreach (var ch in name.ToLowerInvariant()) hash = ch + ((hash << 5) - hash);
        var index = (int)(Math.Abs((long)hash) % NickColors.Length);
        return NickColors[index];
    }

    static string Tier(Dictionary<string, string> tags)
    {
        var plan = Tag(tags, "msg-param-sub-plan");
        if (plan.Equals("Prime", StringComparison.OrdinalIgnoreCase)) return "Prime";
        if (plan == "2000") return "Tier 2";
        if (plan == "3000") return "Tier 3";
        if (plan == "1000") return "Tier 1";
        return "";
    }

    static string JoinBits(params string[] parts)
        => string.Join(" · ", parts.Where(part => part.Length > 0));

    static string Gifted(int count)
    {
        var n10 = count % 10;
        var n100 = count % 100;
        var word = "подписок";
        if (n10 == 1 && n100 != 11) word = "подписка";
        else if (n10 is >= 2 and <= 4 && (n100 < 12 || n100 > 14)) word = "подписки";
        return count + " " + word + " в подарок";
    }

    static string Viewers(int count)
    {
        var n10 = count % 10;
        var n100 = count % 100;
        var word = "зрителей";
        if (n10 == 1 && n100 != 11) word = "зритель";
        else if (n10 is >= 2 and <= 4 && (n100 < 12 || n100 > 14)) word = "зрителя";
        return count + " " + word;
    }

    static int Number(string value) => int.TryParse(value, out var number) ? number : 0;

    static string Tag(Dictionary<string, string> tags, string key)
        => tags.TryGetValue(key, out var value) ? value : "";

    static string Str(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    static string Normalize(string input)
    {
        var raw = (input ?? "").Trim();
        if (raw.Length == 0) throw new Exception("Введи канал");

        var login = raw;
        if (LooksLikeUrl(raw))
        {
            var withoutScheme = Regex.Replace(raw, @"^[a-z][a-z0-9+.-]*://", "", RegexOptions.IgnoreCase);
            var host = withoutScheme.Split('/', '?', '#')[0];
            if (host.StartsWith("www.", StringComparison.OrdinalIgnoreCase)) host = host[4..];
            host = host.ToLowerInvariant();
            if (host != "twitch.tv" && !host.EndsWith(".twitch.tv", StringComparison.Ordinal))
                throw new Exception("Это не ссылка Twitch");
            var slash = withoutScheme.IndexOf('/');
            login = slash >= 0 ? withoutScheme[(slash + 1)..] : "";
        }

        var cut = login.IndexOfAny(['/', '?', '#']);
        if (cut >= 0) login = login[..cut];
        login = login.TrimStart('#').ToLowerInvariant();
        if (!Regex.IsMatch(login, "^[a-z0-9_]{3,25}$")) throw new Exception("Неверный логин канала");
        return login;
    }

    static bool LooksLikeUrl(string value)
    {
        if (Regex.IsMatch(value, @"^[a-z][a-z0-9+.-]*://", RegexOptions.IgnoreCase)) return true;
        return Regex.IsMatch(value, @"^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#]|$)", RegexOptions.IgnoreCase);
    }
}

sealed class Settings
{
    public string Channel { get; set; } = "";
}

sealed class ChatMessage
{
    public string? Time { get; set; }
    public string? Status { get; set; }
    public string DisplayName { get; set; } = "";
    public string? Color { get; set; }
    public List<Badge> Badges { get; set; } = new();
    public List<string> Flags { get; set; } = new();
    public Reply? Reply { get; set; }
    public bool Action { get; set; }
    public List<Part> Parts { get; set; } = new();
}

sealed class Badge
{
    public string Url { get; set; } = "";
    public string Title { get; set; } = "";
}

sealed class Reply
{
    public string Name { get; set; } = "";
    public string Text { get; set; } = "";
}

sealed class Part
{
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public string? Name { get; set; }
    public string? Url { get; set; }
}

sealed class Extra
{
    public bool Action { get; set; }
    public List<string>? Flags { get; set; }
    public Reply? Reply { get; set; }
}

using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;

namespace ChatServer;

public partial class MainWindow : Window
{
    enum Phase { Idle, Connecting, Live, Stopping }
    Phase _phase = Phase.Idle;

    public MainWindow()
    {
        InitializeComponent();
        var version = typeof(MainWindow).Assembly.GetName().Version;
        if (version != null)
            VersionText.Text = version.Build > 0
                ? $"{version.Major}.{version.Minor}.{version.Build}"
                : $"{version.Major}.{version.Minor}";
        Icon = new WindowIcon(Avalonia.Platform.AssetLoader.Open(new Uri("avares://ChatServer/Assets/icon.png")));
        ChannelBox.TextChanged += (_, _) => { if (_phase == Phase.Idle) Paint(); };
        ChannelBox.KeyDown += (_, eventArgs) =>
        {
            if (eventArgs.Key == Key.Enter && _phase == Phase.Idle) _ = Start();
        };
        Paint();
        var saved = App.Session.ReadChannel();
        if (!string.IsNullOrEmpty(saved))
        {
            ChannelBox.Text = saved;
            _ = Start();
        }
    }

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        if (!App.Quitting)
        {
            e.Cancel = true;
            Hide();
        }
        base.OnClosing(e);
    }

    void TitleBarPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        // Не перехватываем нажатия на кнопки управления окном.
        if (e.Source is Button) return;
        if (e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            BeginMoveDrag(e);
    }

    void MinimizeClick(object? sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    void CloseClick(object? sender, RoutedEventArgs e) => Close();

    void QuitClick(object? sender, RoutedEventArgs e) => App.Quit();

    void StartClick(object? sender, RoutedEventArgs e)
    {
        if (_phase == Phase.Live) _ = Stop();
        else _ = Start();
    }

    void Paint()
    {
        switch (_phase)
        {
            case Phase.Connecting:
                StartButton.Content = "Подключение";
                StartButton.IsEnabled = false;
                break;
            case Phase.Live:
                StartButton.Content = "Стоп";
                StartButton.IsEnabled = true;
                break;
            case Phase.Stopping:
                StartButton.Content = "Стоп";
                StartButton.IsEnabled = false;
                break;
            default:
                StartButton.Content = "Старт";
                StartButton.IsEnabled = !string.IsNullOrWhiteSpace(ChannelBox.Text);
                break;
        }
    }

    void HelpOpen(object? sender, RoutedEventArgs e) => Help.IsVisible = true;

    void HelpClose(object? sender, RoutedEventArgs e) => Help.IsVisible = false;

    void OpenAuthor(object? sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("https://github.com/strdns") { UseShellExecute = true });
    }

    async void CopyClick(object? sender, RoutedEventArgs e)
    {
        var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
        if (clipboard != null) await clipboard.SetTextAsync(LinkInput.Text ?? "");
    }

    async Task Start()
    {
        if (_phase != Phase.Idle || string.IsNullOrWhiteSpace(ChannelBox.Text)) return;
        _phase = Phase.Connecting;
        Paint();
        ErrorText.Text = "";
        try
        {
            var result = await App.Session.StartAsync(ChannelBox.Text ?? "");
            if (_phase != Phase.Connecting) return;
            if (!string.IsNullOrEmpty(result.Channel)) ChannelBox.Text = result.Channel;
            if (!string.IsNullOrEmpty(result.Url))
            {
                LinkInput.Text = result.Url;
                LinkBox.IsVisible = true;
            }
            if (!result.Ok) ErrorText.Text = result.Error ?? "Не вышло";
            _phase = result.Ok ? Phase.Live : Phase.Idle;
        }
        catch (Exception ex)
        {
            if (_phase != Phase.Connecting) return;
            ErrorText.Text = ex.Message;
            _phase = Phase.Idle;
        }
        Paint();
    }

    async Task Stop()
    {
        if (_phase != Phase.Live) return;
        _phase = Phase.Stopping;
        Paint();
        try
        {
            await App.Session.StopAsync();
        }
        finally
        {
            _phase = Phase.Idle;
            Paint();
        }
    }
}

using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;

namespace ChatServer;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Icon = new WindowIcon(Avalonia.Platform.AssetLoader.Open(new Uri("avares://ChatServer/Assets/icon.png")));
        ChannelBox.KeyDown += (_, eventArgs) =>
        {
            if (eventArgs.Key == Key.Enter) _ = Start();
        };
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

    void StartClick(object? sender, RoutedEventArgs e) => _ = Start();

    async void CopyClick(object? sender, RoutedEventArgs e)
    {
        var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
        if (clipboard != null) await clipboard.SetTextAsync(LinkInput.Text ?? "");
    }

    async Task Start()
    {
        ErrorText.Text = "";
        try
        {
            var result = await App.Session.StartAsync(ChannelBox.Text ?? "");
            if (!string.IsNullOrEmpty(result.Channel)) ChannelBox.Text = result.Channel;
            if (!string.IsNullOrEmpty(result.Url))
            {
                LinkInput.Text = result.Url;
                LinkBox.IsVisible = true;
            }
            if (!result.Ok) ErrorText.Text = result.Error ?? "Не вышло";
        }
        catch (Exception ex)
        {
            ErrorText.Text = ex.Message;
        }
    }
}

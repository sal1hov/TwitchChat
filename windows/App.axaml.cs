using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Platform;

namespace ChatServer;

public partial class App : Application
{
    public static bool Quitting { get; private set; }
    public static ChatSession Session { get; } = new();
    public static MainWindow? Window { get; private set; }

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            Window = new MainWindow();
            desktop.MainWindow = Window;
            Window.Show();

            var open = new NativeMenuItem("Открыть");
            open.Click += (_, _) => ShowWindow();
            var copy = new NativeMenuItem("Скопировать ссылку");
            copy.Click += async (_, _) =>
            {
                var url = Session.Url;
                if (string.IsNullOrEmpty(url) || Window == null) return;
                var clipboard = TopLevel.GetTopLevel(Window)?.Clipboard;
                if (clipboard != null) await clipboard.SetTextAsync(url);
            };
            var quit = new NativeMenuItem("Выйти");
            quit.Click += (_, _) => Quit();

            var menu = new NativeMenu();
            menu.Items.Add(open);
            menu.Items.Add(copy);
            menu.Items.Add(new NativeMenuItemSeparator());
            menu.Items.Add(quit);

            var tray = new TrayIcon
            {
                Icon = new WindowIcon(AssetLoader.Open(new Uri("avares://ChatServer/Assets/icon.png"))),
                ToolTipText = "ChatServer",
                Menu = menu
            };
            tray.Clicked += (_, _) => ShowWindow();
            var icons = new TrayIcons { tray };
            TrayIcon.SetIcons(this, icons);
        }

        base.OnFrameworkInitializationCompleted();
    }

    public static void ShowWindow()
    {
        if (Window == null) return;
        Window.Show();
        Window.WindowState = WindowState.Normal;
        Window.Activate();
    }

    public static void Quit()
    {
        Quitting = true;
        Session.Dispose();
        if (Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.Shutdown();
    }
}

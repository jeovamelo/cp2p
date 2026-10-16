using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace ComunidadeResilienteDesktop
{
    static class Program
    {
        private static Mutex _mutex = null;
        private static Process _nodeProcess = null;
        private static NotifyIcon _trayIcon = null;
        private static string _appUrl = "http://localhost:5001";

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            const string appGuid = "ComunidadeResiliente_P2P_UniqueApp_9B2BDC96";
            bool createdNew;
            _mutex = new Mutex(true, appGuid, out createdNew);

            if (!createdNew)
            {
                OpenAppWindow();
                return;
            }

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            string nodeExe = Path.Combine(baseDir, "bin", "node.exe");
            if (!File.Exists(nodeExe))
            {
                nodeExe = "node";
            }

            string runnerJs = Path.Combine(baseDir, "src", "desktop", "desktop_runner.js");
            if (!File.Exists(runnerJs))
            {
                runnerJs = Path.Combine(baseDir, "src", "node", "p2p_node.js");
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = "\"" + runnerJs + "\"";
                psi.WorkingDirectory = baseDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.EnvironmentVariables["AUTO_OPEN"] = "false";

                _nodeProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Falha ao iniciar o nó P2P:\n" + ex.Message, "Comunidade Resiliente", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            AppDomain.CurrentDomain.ProcessExit += (s, e) => KillNode();
            Application.ApplicationExit += (s, e) => KillNode();

            SetupTrayIcon(baseDir);

            System.Windows.Forms.Timer openTimer = new System.Windows.Forms.Timer();
            openTimer.Interval = 1200;
            openTimer.Tick += (s, e) => {
                openTimer.Stop();
                openTimer.Dispose();
                OpenAppWindow();
            };
            openTimer.Start();

            Application.Run();
        }

        private static void SetupTrayIcon(string baseDir)
        {
            _trayIcon = new NotifyIcon();
            _trayIcon.Text = "Comunidade Resiliente P2P (Ativo)";

            string iconPath = Path.Combine(baseDir, "installer", "app.ico");
            if (File.Exists(iconPath))
            {
                try { _trayIcon.Icon = new Icon(iconPath); } catch {}
            }
            
            if (_trayIcon.Icon == null)
            {
                Bitmap bmp = new Bitmap(32, 32);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    using (SolidBrush brush = new SolidBrush(Color.FromArgb(16, 185, 129)))
                    {
                        g.FillEllipse(brush, 2, 2, 28, 28);
                    }
                    using (Pen pen = new Pen(Color.White, 3))
                    {
                        g.DrawLines(pen, new Point[] {
                            new Point(9, 16),
                            new Point(14, 21),
                            new Point(23, 11)
                        });
                    }
                }
                _trayIcon.Icon = Icon.FromHandle(bmp.GetHicon());
            }

            _trayIcon.Visible = true;

            ContextMenu menu = new ContextMenu();
            MenuItem openItem = new MenuItem("Abrir Comunidade Resiliente", (s, e) => OpenAppWindow());
            openItem.DefaultItem = true;
            menu.MenuItems.Add(openItem);

            menu.MenuItems.Add(new MenuItem("Abrir no Navegador Externo", (s, e) => {
                try { Process.Start(_appUrl); } catch {}
            }));

            menu.MenuItems.Add(new MenuItem("Status da Rede P2P", (s, e) => {
                try { Process.Start(_appUrl + "/status"); } catch {}
            }));

            menu.MenuItems.Add("-");

            menu.MenuItems.Add(new MenuItem("Sair da Comunidade Resiliente", (s, e) => {
                _trayIcon.Visible = false;
                KillNode();
                Application.Exit();
            }));

            _trayIcon.ContextMenu = menu;
            _trayIcon.DoubleClick += (s, e) => OpenAppWindow();
        }

        private static void OpenAppWindow()
        {
            try {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "msedge.exe";
                psi.Arguments = "--app=\"" + _appUrl + "\" --window-size=1240,840";
                psi.UseShellExecute = true;
                Process.Start(psi);
                return;
            } catch {}

            try {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "chrome.exe";
                psi.Arguments = "--app=\"" + _appUrl + "\" --window-size=1240,840";
                psi.UseShellExecute = true;
                Process.Start(psi);
                return;
            } catch {}

            try { Process.Start(_appUrl); } catch {}
        }

        private static void KillNode()
        {
            try {
                if (_nodeProcess != null && !_nodeProcess.HasExited) {
                    _nodeProcess.Kill();
                }
            } catch {}
        }
    }
}
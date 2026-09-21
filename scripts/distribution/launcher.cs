// SPDX-License-Identifier: AGPL-3.0-or-later
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;

[assembly: AssemblyTitle("EasySch")]
[assembly: AssemblyProduct("EasySch")]
[assembly: AssemblyDescription("EasySch 科研工作台")]
[assembly: AssemblyVersion("0.1.0.0")]

class Launcher {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    static string Quote(string value) {
        // CommandLineToArgvW quoting, including a trailing backslash.
        var s = new StringBuilder("\""); int slash = 0;
        foreach(char c in value) {
            if(c == '\\') { slash++; continue; }
            if(c == '"') { s.Append('\\', slash * 2 + 1); s.Append(c); }
            else { s.Append('\\', slash); s.Append(c); }
            slash = 0;
        }
        s.Append('\\', slash * 2); return s.Append('"').ToString();
    }

    [STAThread] static int Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string app = Path.Combine(root, "client", "zotero.exe");
            if(!File.Exists(app)) throw new Exception("安装文件不完整，请重新安装 EasySch。");
            string home = Environment.GetEnvironmentVariable("EASYSCH_DATA_HOME");
            if(String.IsNullOrEmpty(home)) home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EasySch");
            home = Path.GetFullPath(home);
            string profile = Path.Combine(home, "Profile");
            string library = Path.Combine(home, "Library");
            Directory.CreateDirectory(profile); Directory.CreateDirectory(library);
            string mutexName;
            using(var sha = System.Security.Cryptography.SHA256.Create()) {
                mutexName = "Local\\EasySch-" + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(home.ToLowerInvariant()))).Replace("-", "").Substring(0,24);
            }
            bool created;
            using(var mutex = new Mutex(true, mutexName, out created)) {
                string pidFile = Path.Combine(profile, "easysch-process.txt");
                if(!created) {
                    try {
                        var previous = Process.GetProcessById(Int32.Parse(File.ReadAllText(pidFile)));
                        if(String.Equals(previous.MainModule.FileName, app, StringComparison.OrdinalIgnoreCase)) {
                            ShowWindowAsync(previous.MainWindowHandle, 9); SetForegroundWindow(previous.MainWindowHandle);
                        }
                    } catch { /* An already-starting instance will show its window. */ }
                    return 0;
                }
                string prefs = Path.Combine(profile, "prefs.js");
                if(!File.Exists(prefs)) {
                    var json = new JavaScriptSerializer();
                    File.WriteAllText(prefs,
                        "user_pref(\"extensions.zotero.dataDir\", " + json.Serialize(library) + ");\n" +
                        "user_pref(\"extensions.zotero.useDataDir\", true);\n" +
                        "user_pref(\"extensions.zotero.firstRun2\", false);\n" +
                        "user_pref(\"extensions.zotero.firstRunGuidance\", false);\n" +
                        "user_pref(\"extensions.zotero.sync.autoSync\", false);\n" +
                        "user_pref(\"app.update.auto\", false);\n" +
                        "user_pref(\"app.update.enabled\", false);\n" +
                        "user_pref(\"browser.theme.toolbar-theme\", 1);\n" +
                        "user_pref(\"extensions.easysch.writingAppearance\", \"light\");\n",
                        new UTF8Encoding(false));
                }
                var start = new ProcessStartInfo(app, "-no-remote -profile " + Quote(profile) + " " + String.Join(" ", args.Select(Quote))) {
                    WorkingDirectory = Path.GetDirectoryName(app), UseShellExecute = false
                };
                using(var process = Process.Start(start)) {
                    File.WriteAllText(pidFile, process.Id.ToString());
                    process.WaitForExit();
                    File.Delete(pidFile);
                    return process.ExitCode;
                }
            }
        } catch(Exception error) {
            MessageBox.Show(error.Message, "EasySch 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

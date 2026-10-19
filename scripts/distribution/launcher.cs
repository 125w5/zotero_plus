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
using System.Collections.Generic;

[assembly: AssemblyTitle("EasySch")]
[assembly: AssemblyProduct("EasySch")]
[assembly: AssemblyDescription("EasySch 科研工作台")]
[assembly: AssemblyVersion("0.1.0.0")]

class Launcher {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct ProcessEntry {
        public uint size, usage, processId;
        public IntPtr defaultHeap;
        public uint moduleId, threads, parentProcessId;
        public int basePriority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string executable;
    }

    static Process FindMainProcess(Process starter, string app) {
        starter.Refresh();
        if(starter.HasExited) return null;
        var descendants = new HashSet<uint> { (uint)starter.Id };
        var entries = new List<ProcessEntry>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if(snapshot != new IntPtr(-1)) {
            try {
                var entry = new ProcessEntry { size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
                if(Process32First(snapshot, ref entry)) do { entries.Add(entry); } while(Process32Next(snapshot, ref entry));
            } finally { CloseHandle(snapshot); }
            bool changed;
            do {
                changed = false;
                foreach(var entry in entries) if(descendants.Contains(entry.parentProcessId) && descendants.Add(entry.processId)) changed = true;
            } while(changed);
        }
        foreach(uint id in descendants) {
            Process candidate = null;
            try {
                candidate = Process.GetProcessById((int)id);
                if(candidate.MainWindowHandle != IntPtr.Zero && candidate.StartTime.ToUniversalTime() >= starter.StartTime.ToUniversalTime().AddSeconds(-1)
                    && String.Equals(candidate.MainModule.FileName, app, StringComparison.OrdinalIgnoreCase)) return candidate;
            } catch { /* A child can exit between the process snapshot and inspection. */ }
            if(candidate != null) candidate.Dispose();
        }
        return null;
    }

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
                        string[] identity = File.ReadAllLines(pidFile);
                        using(var previous = Process.GetProcessById(Int32.Parse(identity[0]))) {
                            if(identity.Length == 2 && previous.StartTime.ToUniversalTime().Ticks == Int64.Parse(identity[1])
                                && String.Equals(previous.MainModule.FileName, app, StringComparison.OrdinalIgnoreCase)) {
                                IntPtr window = previous.MainWindowHandle;
                                if(IsIconic(window)) ShowWindowAsync(window, 9);
                                SetForegroundWindow(window);
                            }
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
                var start = new ProcessStartInfo(app, "--wait-for-browser -no-remote -profile " + Quote(profile) + " " + String.Join(" ", args.Select(Quote))) {
                    WorkingDirectory = Path.GetDirectoryName(app), UseShellExecute = false
                };
                // Use the shipped runtimes even on machines with unrelated
                // Python/Node installations or inherited developer options.
                foreach (string name in new[] { "PYTHONHOME", "PYTHONPATH", "NODE_PATH", "NODE_OPTIONS" })
                    start.EnvironmentVariables.Remove(name);
                start.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
                using(var process = Process.Start(start)) {
                    try {
                        // Mozilla's Windows starter owns no window. Track only
                        // its own child tree and persist the actual GUI identity.
                        Process main = null;
                        while(!process.HasExited && main == null) { main = FindMainProcess(process, app); if(main == null) Thread.Sleep(200); }
                        if(main != null) using(main) File.WriteAllLines(pidFile, new[] { main.Id.ToString(), main.StartTime.ToUniversalTime().Ticks.ToString() });
                        process.WaitForExit();
                        return process.ExitCode;
                    } finally { if(File.Exists(pidFile)) File.Delete(pidFile); }
                }
            }
        } catch(Exception error) {
            MessageBox.Show(error.Message, "EasySch 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

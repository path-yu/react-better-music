param(
  [Parameter(Mandatory = $true)][int]$AppPid,
  [Parameter(Mandatory = $true)][string]$WindowTitle,
  [Parameter(Mandatory = $true)][string]$IconPath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShengYuTray {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowW(string className, string windowName);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
}
"@

$notify = New-Object System.Windows.Forms.NotifyIcon
try {
  $notify.Icon = New-Object System.Drawing.Icon($IconPath)
} catch {
  $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Text = $WindowTitle
$notify.Visible = $true

function Show-AppWindow {
  # FindWindowW with a NULL class name is unreliable from PowerShell; the
  # Electrobun window class is stable, so look it up by class + title.
  $hwnd = [ShengYuTray]::FindWindowW('BasicWindowClass', $WindowTitle)
  if ($hwnd -eq [IntPtr]::Zero) { return }
  if ([ShengYuTray]::IsIconic($hwnd)) {
    [void][ShengYuTray]::ShowWindow($hwnd, 9)  # SW_RESTORE
  } else {
    [void][ShengYuTray]::ShowWindow($hwnd, 5)  # SW_SHOW
  }
  [void][ShengYuTray]::SetForegroundWindow($hwnd)
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $menu.Items.Add('显示主窗口')
$showItem.add_Click({ Show-AppWindow })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quitItem = $menu.Items.Add('退出声屿')
$quitItem.add_Click({
  $notify.Visible = $false
  $notify.Dispose()
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -like '*com.qimiao.music*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $AppPid -Force -ErrorAction SilentlyContinue
  [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $menu

# Left click opens the app window; the context menu only appears on right click.
$notify.add_MouseClick({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    Show-AppWindow
  }
})
$notify.add_DoubleClick({ Show-AppWindow })

# Close the helper when the app process is gone (quit from anywhere).
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 2000
$watch.add_Tick({
  if (-not (Get-Process -Id $AppPid -ErrorAction SilentlyContinue)) {
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
  }
})
$watch.Start()

[System.Windows.Forms.Application]::Run()

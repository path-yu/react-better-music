param(
  [Parameter(Mandatory = $true)][string]$WindowTitle
)

# Auxiliary windows (desktop lyrics, mini player) should behave like tool
# windows: always-on-top, but absent from the taskbar and Alt-Tab list.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class QimiaoTaskbar {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowW(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
  public static extern IntPtr SetWindowLongPtrW(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $hwnd -eq [IntPtr]::Zero; $i++) {
  $hwnd = [QimiaoTaskbar]::FindWindowW('BasicWindowClass', $WindowTitle)
  if ($hwnd -eq [IntPtr]::Zero) {
    $hwnd = [QimiaoTaskbar]::FindWindowW($null, $WindowTitle)
  }
  if ($hwnd -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 100
  }
}

if ($hwnd -eq [IntPtr]::Zero) {
  exit 0
}

$style = [QimiaoTaskbar]::GetWindowLongPtrW($hwnd, $GWL_EXSTYLE).ToInt64()
$style = ($style -band (-bnot $WS_EX_APPWINDOW)) -bor $WS_EX_TOOLWINDOW
[void][QimiaoTaskbar]::SetWindowLongPtrW($hwnd, $GWL_EXSTYLE, [IntPtr]$style)
[void][QimiaoTaskbar]::SetWindowPos(
  $hwnd,
  [IntPtr]::Zero,
  0, 0, 0, 0,
  $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED
)

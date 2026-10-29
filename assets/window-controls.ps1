param(
  [Parameter(Mandatory = $true)][string]$WindowTitle
)

# Electrobun's hiddenInset chrome removes WS_MINIMIZEBOX / WS_MAXIMIZEBOX on
# Windows. The window still draws its own buttons, but the OS taskbar cannot
# minimize it and BrowserWindow.minimize() becomes a no-op. Restore the two
# style bits without changing the custom title bar.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class QimiaoWindowControls {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowW(string className, string windowName);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
  public static extern IntPtr SetWindowLongPtrW(IntPtr hWnd, int nIndex, IntPtr value);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
}
"@

$hwnd = [IntPtr]::Zero
for ($attempt = 0; $attempt -lt 20 -and $hwnd -eq [IntPtr]::Zero; $attempt += 1) {
  $hwnd = [QimiaoWindowControls]::FindWindowW('BasicWindowClass', $WindowTitle)
  if ($hwnd -eq [IntPtr]::Zero) {
    $hwnd = [QimiaoWindowControls]::FindWindowW($null, $WindowTitle)
  }
  if ($hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
}
if ($hwnd -eq [IntPtr]::Zero) { exit 0 }

$GWL_STYLE = -16
$WS_MAXIMIZEBOX = 0x00010000
$WS_MINIMIZEBOX = 0x00020000
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020

$style = [QimiaoWindowControls]::GetWindowLongPtrW($hwnd, $GWL_STYLE).ToInt64()
$updated = $style -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX
if ($updated -ne $style) {
  [void][QimiaoWindowControls]::SetWindowLongPtrW($hwnd, $GWL_STYLE, [IntPtr]$updated)
  [void][QimiaoWindowControls]::SetWindowPos(
    $hwnd,
    [IntPtr]::Zero,
    0, 0, 0, 0,
    $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED
  )
}

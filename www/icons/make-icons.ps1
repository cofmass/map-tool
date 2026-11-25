# 生成 PWA 图标：icon-192.png / icon-512.png / apple-touch-icon.png（180x180，圆角深底 + 地图 emoji）
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$out, [bool]$apple) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg = [System.Drawing.Color]::FromArgb(255, 15, 23, 42) # #0f172a
  $brush = New-Object System.Drawing.SolidBrush($bg)
  if ($apple) {
    $g.FillRectangle($brush, 0, 0, $size, $size)   # iOS 不支持透明，填满
  } else {
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
    $path.AddArc($size-2*$r, 0, 2*$r, 2*$r, 270, 90)
    $path.AddArc($size-2*$r, $size-2*$r, 2*$r, 2*$r, 0, 90)
    $path.AddArc(0, $size-2*$r, 2*$r, 2*$r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
  }

  # 地图 emoji 字符（Segoe UI Emoji）
  $emoji = [char]0xD83D + [char]0xDDFA + [char]0xFE0F  # 🗺️
  $font = New-Object System.Drawing.Font('Segoe UI Emoji', [float]($size * 0.52))
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'
  $sf.LineAlignment = 'Center'
  $g.DrawString($emoji, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $sf)

  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "OK $out ($size x $size)"
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $dir
New-Icon 192 'icon-192.png' $false
New-Icon 512 'icon-512.png' $false
New-Icon 180 'apple-touch-icon.png' $true
Pop-Location

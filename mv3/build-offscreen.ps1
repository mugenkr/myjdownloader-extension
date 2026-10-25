# Regenerates offscreen.html and mv3/offscreen/* from index.html.
# Scripts that use the chrome.* API are copied with `chrome` renamed to `mv3chrome`,
# which mv3/offscreen-shim.js defines as a bridge to the service worker.
$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $PSScriptRoot 'offscreen'
$utf8 = New-Object Text.UTF8Encoding $false

if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }

$skip = @('vendor/js/angular.js', 'vendor/js/angular-route.js', 'vendor/js/require.js')
$pattern = '(?<![\w.''"/:-])chrome\b(?!:)'

$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'))
$html = [regex]::Replace($html, '<script src="([^"]+)"></script>', {
    param($m)
    $src = $m.Groups[1].Value -replace '^(\.\./)+', ''
    $file = Join-Path $root $src
    $code = [IO.File]::ReadAllText($file)
    if ($skip -contains $src -or -not [regex]::IsMatch($code, $pattern)) {
        return '<script src="' + $src + '"></script>'
    }
    $target = Join-Path $outDir $src
    New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null
    $code = [regex]::Replace($code, $pattern, 'mv3chrome')
    # Chrome now defines `browser` too, which would overwrite the bridge with the limited offscreen API
    $code = $code.Replace("if (typeof browser !== 'undefined') { mv3chrome = browser; }", '')
    [IO.File]::WriteAllText($target, $code, $utf8)
    return '<script src="mv3/offscreen/' + $src + '"></script>'
})
$html = $html.Replace('<body id="{{bodyClass}}" ng-csp>', "<body id=`"{{bodyClass}}`" ng-csp>`r`n`r`n    <script src=`"mv3/offscreen-shim.js`"></script>")
[IO.File]::WriteAllText((Join-Path $root 'offscreen.html'), $html, $utf8)

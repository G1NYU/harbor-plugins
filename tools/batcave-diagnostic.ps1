# BatCave source diagnostic, Windows PowerShell 5.1+
# Queries only batcave.biz using a fresh in-memory cookie jar.
# Does not read browser profiles, secret keys or protected content.
# No challenge solving, application changes, installs or file writes.
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$Base = [Uri]'https://batcave.biz/'
$UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
$Handler = New-Object System.Net.Http.HttpClientHandler
$Handler.UseCookies = $true
$Handler.AllowAutoRedirect = $false
$Handler.CookieContainer = New-Object System.Net.CookieContainer
$Client = New-Object System.Net.Http.HttpClient($Handler)
$Client.Timeout = [TimeSpan]::FromSeconds(15)

function Test-Cookie([string]$Name) {
    foreach ($cookie in $Handler.CookieContainer.GetCookies($Base)) {
        if ($cookie.Name -eq $Name -and -not [string]::IsNullOrEmpty($cookie.Value)) {
            return 'yes'
        }
    }
    return 'no'
}

function Request-BatCave([string]$Path, [bool]$Post) {
    $uri = [Uri]::new($Base, $Path)
    if ($uri.Host -ne 'batcave.biz' -or $uri.Scheme -ne 'https') {
        throw 'Only https://batcave.biz requests are allowed'
    }
    $method = if ($Post) { [System.Net.Http.HttpMethod]::Post } else { [System.Net.Http.HttpMethod]::Get }
    $message = [System.Net.Http.HttpRequestMessage]::new($method, $uri)
    $null = $message.Headers.TryAddWithoutValidation('User-Agent', $UserAgent)
    $null = $message.Headers.TryAddWithoutValidation('Accept', 'text/html,application/xhtml+xml,*/*')
    if ($Post) {
        $body = 'dlenewssortby=rating&dledirection=desc&set_new_sort=dle_sort_cat_1&set_direction_sort=dle_direction_cat_1'
        $message.Content = [System.Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/x-www-form-urlencoded')
    }
    try {
        $response = $Client.SendAsync($message).GetAwaiter().GetResult()
        $html = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $location = $response.Headers.Location
        $guard = 'no'
        $redirectPath = 'none'
        if ($null -ne $location) {
            $redirect = [Uri]::new($uri, $location)
            $redirectPath = if ($redirect.Host -eq 'batcave.biz') { $redirect.AbsolutePath } else { 'external' }
            if ($redirect.Host -eq 'batcave.biz' -and $redirect.AbsolutePath -match '^/_c(?:/|$)') {
                $guard = 'yes'
            }
        }
        $cf = if ($html -match '(?i)just a moment|cf-challenge|challenge-platform|cf-chl') { 'yes' } else { 'no' }
        $pow = if ($html -match '(?i)pow_nonce|token\s*:') { 'yes' } else { 'no' }
        $content = if ($html -match '(?i)id="dle-content"|window\.__DATA__|class="readed') { 'yes' } else { 'no' }
        $kind = if ($Post) { 'POST' } else { 'GET' }
        Write-Output ('{0} {1} | HTTP {2} | redirect {3} | DLE redirect {4} | CF HTML {5} | PoW HTML {6} | BatCave content {7}' -f $kind, $uri.AbsolutePath, [int]$response.StatusCode, $redirectPath, $guard, $cf, $pow, $content)
        $response.Dispose()
    } catch {
        Write-Output ('HTTP request failed ({0}); no cookies or credentials are exposed' -f $Path)
    } finally {
        $message.Dispose()
    }
}

try {
    Write-Output 'BatCave network probe: no credentials or cookie values displayed'
    Request-BatCave '/' $false
    Request-BatCave '/comix/' $false
    Request-BatCave '/comix/' $true
    Request-BatCave '/search/spider-man/' $false
    Write-Output ("Session created during probe: DLE trust={0}; Cloudflare clearance={1}" -f (Test-Cookie '__guard_trust'), (Test-Cookie 'cf_clearance'))
    Write-Output 'A DLE redirect is not Cloudflare: if CF HTML is yes, a separate browser check is involved.'
} finally {
    $Client.Dispose()
    $Handler.Dispose()
}

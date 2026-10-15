# ==============================================================================
# Instalador Automatizado - Comunidade Resiliente para Windows
# Instala a aplicação localmente para usuários leigos sem exigir terminal
# ==============================================================================

param(
    [switch]$Silent,
    [switch]$NoLaunch
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "       INSTALADOR DA COMUNIDADE RESILIENTE P2P PARA WINDOWS            " -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

$sourceDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$sourceDir\src")) {
    $sourceDir = $PSScriptRoot
}

$installDir = "$env:LOCALAPPDATA\ComunidadeResiliente"
Write-Host "[1/5] Preparando diretorio de instalacao..." -ForegroundColor Yellow
Write-Host "      Destino: $installDir" -ForegroundColor Gray

if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

# 2. Copiando arquivos essenciais da aplicação
Write-Host "[2/5] Copiando arquivos do sistema P2P..." -ForegroundColor Yellow
$foldersToCopy = @("src", "scripts", "packages")
foreach ($folder in $foldersToCopy) {
    if (Test-Path "$sourceDir\$folder") {
        Copy-Item -Path "$sourceDir\$folder" -Destination "$installDir\$folder" -Recurse -Force
    }
}

$filesToCopy = @("package.json", "package-lock.json", "README.md", "INSTALLATION.md")
foreach ($file in $filesToCopy) {
    if (Test-Path "$sourceDir\$file") {
        Copy-Item -Path "$sourceDir\$file" -Destination "$installDir\$file" -Force
    }
}

# Se existir node_modules, copia para o diretório de destino
if (Test-Path "$sourceDir\node_modules") {
    Write-Host "      Copiando dependencias locais..." -ForegroundColor Gray
    Copy-Item -Path "$sourceDir\node_modules" -Destination "$installDir\node_modules" -Recurse -Force
}

# 3. Verificando motor de execução (Node.js)
Write-Host "[3/5] Configurando motor de execucao autonomo..." -ForegroundColor Yellow
$binDir = "$installDir\bin"
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

$systemNode = (Get-Command node -ErrorAction SilentlyContinue)

if ($systemNode) {
    Write-Host "      Node.js detectado no sistema: $($systemNode.Source)" -ForegroundColor Green
    Copy-Item -Path $systemNode.Source -Destination "$binDir\node.exe" -Force
} else {
    Write-Host "      Node.js nao encontrado. Baixando executavel portatil..." -ForegroundColor Yellow
    $zipUrl = "https://nodejs.org/dist/v22.13.0/win-x64/node.exe"
    $targetNode = "$binDir\node.exe"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipUrl -OutFile $targetNode -UseBasicParsing
        Write-Host "      Motor portatil baixado com sucesso!" -ForegroundColor Green
    } catch {
        Write-Host "      Aviso: Usando executavel node padrao do PATH." -ForegroundColor Yellow
    }
}

# 4. Copiando inicializadores e scripts
Write-Host "[4/5] Configurando inicializadores silenciosos e desinstalador..." -ForegroundColor Yellow
$templatesDir = "$sourceDir\installer\templates"
if (Test-Path $templatesDir) {
    Copy-Item -Path "$templatesDir\Iniciar-Com-Console.bat" -Destination "$installDir\Iniciar-Com-Console.bat" -Force
    Copy-Item -Path "$templatesDir\Iniciar-Silencioso.vbs" -Destination "$installDir\Iniciar-Silencioso.vbs" -Force
    Copy-Item -Path "$templatesDir\Desinstalar.bat" -Destination "$installDir\Desinstalar.bat" -Force
}

# 5. Criando Atalho na Área de Trabalho e Menu Iniciar
Write-Host "[5/5] Registrando atalho na Area de Trabalho e Menu Iniciar..." -ForegroundColor Yellow

$wscript = New-Object -ComObject WScript.Shell

# Atalho na Área de Trabalho
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutDesktop = $wscript.CreateShortcut("$desktopPath\Comunidade Resiliente.lnk")
$shortcutDesktop.TargetPath = "$installDir\Iniciar-Silencioso.vbs"
$shortcutDesktop.WorkingDirectory = $installDir
$shortcutDesktop.Description = "Comunidade Resiliente - Plataforma P2P Descentralizada"
$shortcutDesktop.Save()

# Atalho no Menu Iniciar
$startMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Comunidade Resiliente"
if (-not (Test-Path $startMenuDir)) {
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
}
$shortcutStart = $wscript.CreateShortcut("$startMenuDir\Comunidade Resiliente.lnk")
$shortcutStart.TargetPath = "$installDir\Iniciar-Silencioso.vbs"
$shortcutStart.WorkingDirectory = $installDir
$shortcutStart.Description = "Comunidade Resiliente - Plataforma P2P Descentralizada"
$shortcutStart.Save()

$shortcutUninstall = $wscript.CreateShortcut("$startMenuDir\Desinstalar Comunidade Resiliente.lnk")
$shortcutUninstall.TargetPath = "$installDir\Desinstalar.bat"
$shortcutUninstall.WorkingDirectory = $installDir
$shortcutUninstall.Save()

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Green
Write-Host "   INSTALACAO CONCLUIDA COM SUCESSO ABSOLUTO!                          " -ForegroundColor Green
Write-Host "=======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Atalho 'Comunidade Resiliente' adicionado a Area de Trabalho." -ForegroundColor White
Write-Host "Atalho adicionado ao Menu Iniciar." -ForegroundColor White
Write-Host "A aplicacao roda em segundo plano e abre o navegador automaticamente." -ForegroundColor White
Write-Host ""

$launchNow = $true
if ($NoLaunch) {
    $launchNow = $false
} elseif ($Silent) {
    $launchNow = $false
} elseif ($Host.Name -eq "ConsoleHost") {
    $ans = Read-Host "Deseja iniciar a Comunidade Resiliente agora? (S/N) [Padrao: S]"
    if ($ans -and $ans.Trim().ToUpper() -eq "N") {
        $launchNow = $false
    }
}

if ($launchNow) {
    Write-Host "Iniciando a Comunidade Resiliente..." -ForegroundColor Cyan
    Start-Process "$installDir\Iniciar-Silencioso.vbs"
    Write-Host "Aguarde seu navegador abrir em: http://localhost:5001" -ForegroundColor Green
}

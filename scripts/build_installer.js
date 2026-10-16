const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const workspaceDir = path.resolve(__dirname, '..');
process.chdir(workspaceDir);

console.log('=== INICIANDO CONSTRUÇÃO DO EXECUTÁVEL E INSTALADOR WINDOWS ===\n');

// 1. Criar diretório installer caso não exista
if (!fs.existsSync('installer')) {
  fs.mkdirSync('installer', { recursive: true });
}

// 2. Garantir arquivo LICENSE
if (!fs.existsSync('LICENSE')) {
  const mitLicense = `MIT License

Copyright (c) 2026 Comunidade Resiliente

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  fs.writeFileSync('LICENSE', mitLicense, 'utf8');
  console.log('✓ LICENSE criado.');
}

// 3. Gerar app.ico usando C# e System.Drawing se não existir
if (!fs.existsSync(path.join('installer', 'app.ico'))) {
  console.log('[1/5] Gerando ícone oficial do aplicativo (app.ico)...');
  const makeIconCs = `
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;

public class MakeIcon {
    public static void Main() {
        using (Bitmap bmp = new Bitmap(256, 256)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                
                using (SolidBrush b = new SolidBrush(Color.FromArgb(16, 185, 129))) {
                    g.FillEllipse(b, 10, 10, 236, 236);
                }
                using (Pen p = new Pen(Color.FromArgb(5, 150, 105), 8)) {
                    g.DrawEllipse(p, 10, 10, 236, 236);
                }
                
                using (Pen whitePen = new Pen(Color.White, 20)) {
                    whitePen.StartCap = LineCap.Round;
                    whitePen.EndCap = LineCap.Round;
                    g.DrawLines(whitePen, new Point[] {
                        new Point(65, 130),
                        new Point(110, 175),
                        new Point(195, 85)
                    });
                }
            }
            IntPtr hIcon = bmp.GetHicon();
            using (Icon ico = Icon.FromHandle(hIcon)) {
                using (FileStream fs = new FileStream("installer\\\\app.ico", FileMode.Create)) {
                    ico.Save(fs);
                }
            }
        }
        Console.WriteLine("app.ico gerado com sucesso!");
    }
}
`;

  fs.writeFileSync(path.join('installer', 'MakeIcon.cs'), makeIconCs.trim(), 'utf8');
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const makeIconSource = path.join('installer', 'MakeIcon.cs');
  const makeIconOut = path.join('installer', 'MakeIcon.exe');

  execSync(`"${cscPath}" /nologo /out:"${makeIconOut}" /r:System.Drawing.dll "${makeIconSource}"`, { stdio: 'inherit' });
  execSync(`"${makeIconOut}"`, { stdio: 'inherit' });
  if (fs.existsSync(makeIconSource)) fs.unlinkSync(makeIconSource);
  if (fs.existsSync(makeIconOut)) fs.unlinkSync(makeIconOut);
}

// 4. Compilar ComunidadeResiliente.exe se não existir ou atualizar
console.log('\n[2/5] Compilando executável nativo do aplicativo (ComunidadeResiliente.exe)...');
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const programCsPath = path.join('src', 'desktop', 'Program.cs');
const iconArgPath = path.join('installer', 'app.ico');

const compileAppCmd = `"${cscPath}" /nologo /target:winexe /win32icon:"${iconArgPath}" /out:ComunidadeResiliente.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll "${programCsPath}"`;
execSync(compileAppCmd, { stdio: 'inherit' });
console.log('✓ ComunidadeResiliente.exe gerado com sucesso!');

// 5. Garantir bin/node.exe
console.log('\n[3/5] Verificando runtime embutido (bin/node.exe)...');
if (!fs.existsSync(path.join('bin', 'node.exe'))) {
  fs.mkdirSync('bin', { recursive: true });
  fs.copyFileSync('C:\\Program Files\\nodejs\\node.exe', path.join('bin', 'node.exe'));
}
console.log(`✓ bin/node.exe presente (${(fs.statSync(path.join('bin', 'node.exe')).size / 1024 / 1024).toFixed(1)} MB).`);

// 6. Atualizar installer/setup.iss
console.log('\n[4/5] Atualizando script do instalador Inno Setup (setup.iss)...');
const issContent = `; ==============================================================================
; Inno Setup Script - Comunidade Resiliente
; Compila o Instalador Executável Nativo do Windows (ComunidadeResiliente-Setup.exe)
; ==============================================================================

#define MyAppName "Comunidade Resiliente"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Comunidade Resiliente P2P"
#define MyAppURL "https://github.com/comunidade-resiliente"
#define MyAppExeName "ComunidadeResiliente.exe"

[Setup]
AppId={{9B2BDC96-DD63-4B7F-AF35-31E2599A7654}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=..\\LICENSE
OutputDir=..\\dist
OutputBaseFilename=ComunidadeResiliente-Setup-v1.0
SetupIconFile=app.ico
UninstallDisplayIcon={app}\\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "dist\\*,data_test_simulation\\*,tests\\*,*.git*,*.tmp,*.log"

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\\installer\\app.ico"
Name: "{group}\\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\\installer\\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
`;

fs.writeFileSync(path.join('installer', 'setup.iss'), issContent, 'utf8');
console.log('✓ installer/setup.iss configurado com sucesso!');

// 7. Compilar o Instalador Executável (Setup.exe)
console.log('\n[5/5] Compilando instalador final (.exe) com Inno Setup Compiler...');
const candidateIsccPaths = [
  'C:\\Users\\jeova\\AppData\\Local\\Programs\\Antigravity IDE\\resources\\app\\node_modules\\innosetup\\bin\\ISCC.exe',
  'C:\\Users\\jeova\\AppData\\Local\\Programs\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe'
];
const isccPath = candidateIsccPaths.find(p => fs.existsSync(p));
if (!isccPath) {
  throw new Error('ISCC.exe (Inno Setup Compiler) não encontrado nas localizações padrão.');
}
console.log(`Usando compilador Inno Setup: ${isccPath}`);
execSync(`"${isccPath}" "${path.join('installer', 'setup.iss')}"`, { stdio: 'inherit' });

if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}
const distFiles = fs.readdirSync('dist');
console.log('\n======================================================');
console.log('  SUCESSO ABSOLUTO! EXECUTÁVEL DO INSTALADOR GERADO:');
distFiles.forEach(f => {
  const st = fs.statSync(path.join('dist', f));
  console.log(`  -> dist/${f} (${(st.size / 1024 / 1024).toFixed(2)} MB)`);
});
console.log('======================================================\n');

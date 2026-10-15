#!/usr/bin/env bash
# ==============================================================================
# Instalador Automatizado para Linux e macOS - Comunidade Resiliente
# ==============================================================================

set -e

echo "======================================================================="
echo "       INSTALADOR DA COMUNIDADE RESILIENTE P2P (LINUX / MACOS)         "
echo "======================================================================="
echo ""

INSTALL_DIR="$HOME/.local/share/comunidade-resiliente"
BIN_DIR="$HOME/.local/bin"

echo "[1/4] Criando diretório de instalação: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[2/4] Copiando arquivos da aplicação..."
cp -r "$SCRIPT_DIR/src" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/scripts" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/packages" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/"
if [ -d "$SCRIPT_DIR/node_modules" ]; then
    cp -r "$SCRIPT_DIR/node_modules" "$INSTALL_DIR/"
fi

echo "[3/4] Criando executável de inicialização..."
cat << 'EOF' > "$BIN_DIR/comunidade-resiliente"
#!/usr/bin/env bash
APP_DIR="$HOME/.local/share/comunidade-resiliente"
cd "$APP_DIR"
export AUTO_OPEN="true"
export HTTP_PORT="5001"
export P2P_PORT="6001"
export ROLE="Membro"
node src/desktop/desktop_runner.js
EOF

chmod +x "$BIN_DIR/comunidade-resiliente"

# Criar atalho no Linux (.desktop)
if [ "$(uname)" = "Linux" ]; then
    DESKTOP_DIR="$HOME/.local/share/applications"
    mkdir -p "$DESKTOP_DIR"
    cat << EOF > "$DESKTOP_DIR/comunidade-resiliente.desktop"
[Desktop Entry]
Name=Comunidade Resiliente
Comment=Rede P2P Descentralizada e Imune a Quedas
Exec=$BIN_DIR/comunidade-resiliente
Icon=network-workgroup
Terminal=false
Type=Application
Categories=Network;Chat;
EOF
    echo "✓ Atalho de aplicativo criado no Linux (.desktop)!"
fi

echo ""
echo "======================================================================="
echo "   INSTALAÇÃO CONCLUÍDA COM SUCESSO!                                   "
echo "======================================================================="
echo "✓ Executável disponível em: $BIN_DIR/comunidade-resiliente"
echo "✓ Para iniciar, basta executar: comunidade-resiliente"
echo ""

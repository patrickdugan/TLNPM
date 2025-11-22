#!/bin/bash
set -euo pipefail

########################################
# CONFIG — change these for your machine
########################################
PROJECT_ROOT="/path/to/your/project"         # <- set to your project root
APP_DIR="$PROJECT_ROOT/node_modules/tradelayer"
BTC_VERSION="22.0"                            # Taproot-capable old-but-stable release
NETWORK="bitcoin-mainnet"                     # bitcoin-mainnet | bitcoin-testnet

# RPC creds for your algo (simple mode)
RPC_USER="user"
RPC_PASS="pass"

# Wallet name (created if missing)
WALLET_NAME="mywallet"

########################################
# Derived settings (do not edit)
########################################
if [[ "$NETWORK" == "bitcoin-testnet" ]]; then
  IS_TESTNET=1
  RPC_PORT=18332
  NET_FLAG="-testnet"
  CONF_SECTION="[test]"
else
  IS_TESTNET=0
  RPC_PORT=8332
  NET_FLAG=""
  CONF_SECTION="[main]"
fi

DATADIR="$HOME/.bitcoin"
BITCOIN_CONF="$DATADIR/bitcoin.conf"
BITCOIN_URL="https://bitcoincore.org/bin/bitcoin-core-$BTC_VERSION/bitcoin-$BTC_VERSION-x86_64-linux-gnu.tar.gz"
PKG_TAR="bitcoin-$BTC_VERSION-x86_64-linux-gnu.tar.gz"
PKG_DIR="bitcoin-$BTC_VERSION"

echo "=== Starting setup for TradeLayer (Bitcoin) ==="

########################################
# 0) NPM deps (for your package / repo)
########################################
echo "Installing NPM dependencies (project root)…"
cd "$PROJECT_ROOT"
npm install

########################################
# 1) Write .env for the core module (BTC)
########################################
mkdir -p "$APP_DIR"
cat > "$APP_DIR/.env" <<EOF
CHAIN=BTC
RPC_HOST=127.0.0.1
RPC_PORT=$RPC_PORT
RPC_USER=$RPC_USER
RPC_PASS=$RPC_PASS
AUTODETECT=0
TIMEOUT_MS=60000
EOF
echo ".env written to $APP_DIR/.env"

########################################
# 2) Fetch & install Bitcoin Core $BTC_VERSION
########################################
echo "Fetching bitcoind binaries (v$BTC_VERSION)…"
cd "$HOME"
if [[ ! -f "$PKG_TAR" ]]; then
  wget -q "$BITCOIN_URL"
fi

echo "Extracting bitcoind…"
tar -xzf "$PKG_TAR"
sudo install -m 0755 -o root -g root "$PKG_DIR/bin/"* /usr/local/bin/
bitcoind -version

########################################
# 3) Write bitcoin.conf (simple RPC creds + prune)
########################################
echo "Configuring $BITCOIN_CONF …"
mkdir -p "$DATADIR"
# Create fresh if missing; otherwise ensure required keys exist/updated
if [[ ! -f "$BITCOIN_CONF" ]]; then
  cat > "$BITCOIN_CONF" <<EOF
server=1
daemon=1
prune=2000
txindex=0
dbcache=450

rpcuser=$RPC_USER
rpcpassword=$RPC_PASS

$CONF_SECTION
rpcport=$RPC_PORT
EOF
  echo "Created $BITCOIN_CONF"
else
  # Ensure essential values are present/updated
  grep -q '^server=' "$BITCOIN_CONF" || echo "server=1" >> "$BITCOIN_CONF"
  grep -q '^daemon=' "$BITCOIN_CONF" || echo "daemon=1" >> "$BITCOIN_CONF"
  grep -q '^prune='  "$BITCOIN_CONF" || echo "prune=2000" >> "$BITCOIN_CONF"
  grep -q '^txindex=' "$BITCOIN_CONF" || echo "txindex=0" >> "$BITCOIN_CONF"
  grep -q '^dbcache=' "$BITCOIN_CONF" || echo "dbcache=450" >> "$BITCOIN_CONF"

  if grep -q '^rpcuser=' "$BITCOIN_CONF"; then
    sed -i "s/^rpcuser=.*/rpcuser=$RPC_USER/" "$BITCOIN_CONF"
  else
    echo "rpcuser=$RPC_USER" >> "$BITCOIN_CONF"
  fi

  if grep -q '^rpcpassword=' "$BITCOIN_CONF"; then
    sed -i "s/^rpcpassword=.*/rpcpassword=$RPC_PASS/" "$BITCOIN_CONF"
  else
    echo "rpcpassword=$RPC_PASS" >> "$BITCOIN_CONF"
  fi

  # Ensure correct port under the right section
  if ! grep -q "^\[test\]\|\[main\]" "$BITCOIN_CONF"; then
    # add section if none present
    echo "$CONF_SECTION" >> "$BITCOIN_CONF"
  fi
  # remove any existing rpcport in file and set current
  sed -i "/^rpcport=/d" "$BITCOIN_CONF"
  echo "rpcport=$RPC_PORT" >> "$BITCOIN_CONF"

  echo "Updated $BITCOIN_CONF"
fi

########################################
# 4) Start bitcoind (mainnet or testnet)
########################################
echo "Starting bitcoind ($NETWORK) …"
# Stop any stray instance (ignore errors)
bitcoin-cli $NET_FLAG stop >/dev/null 2>&1 || true
pkill -f bitcoind >/dev/null 2>&1 || true
sleep 2

bitcoind -daemon $NET_FLAG
sleep 3

########################################
# 5) Wait until RPC is ready
########################################
echo "Waiting for bitcoind RPC @ 127.0.0.1:$RPC_PORT …"
until bitcoin-cli $NET_FLAG -rpcconnect=127.0.0.1 -rpcport=$RPC_PORT -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" getblockchaininfo >/dev/null 2>&1; do
  echo " … still initializing (will retry)…"
  sleep 5
done
echo "bitcoind is ready."

########################################
# 6) Create or load wallet; print address
########################################
echo "Preparing wallet: $WALLET_NAME"
# listwallets returns a JSON array of loaded wallets
if ! bitcoin-cli $NET_FLAG -rpcport=$RPC_PORT -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" listwallets | grep -q "\"$WALLET_NAME\""; then
  # if wallet file exists on disk, load; else create
  if bitcoin-cli $NET_FLAG -rpcport=$RPC_PORT -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" listwalletdir | grep -q "\"$WALLET_NAME\""; then
    echo "Loading existing wallet…"
    bitcoin-cli $NET_FLAG -rpcport=$RPC_PORT -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" loadwallet "$WALLET_NAME" >/dev/null
  else
    echo "Creating new wallet…"
    bitcoin-cli $NET_FLAG -rpcport=$RPC_PORT -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" createwallet "$WALLET_NAME" >/dev/null
  fi
fi

echo "Generating a new address…"
ADDR=$(bitcoin-cli $NET_FLAG -rpcport=$RPC_PORT -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" -rpcwallet="$WALLET_NAME" getnewaddress "" bech32)
echo "Wallet address: $ADDR"

########################################
# 7) TradeLayer JS setup (your repo)
########################################
cd "$PROJECT_ROOT"

if [[ ! -d "tradelayer.js" ]]; then
  echo "Cloning TradeLayer.js…"
  git clone https://github.com/patrickdugan/tradelayer.js.git
fi

cd tradelayer.js
echo "Checking out dtf-UTXO…"
git fetch --all
git checkout dtf-UTXO || true

echo "Installing TradeLayer.js deps…"
npm install
echo "Removing bitcore-lib-ltc (not needed for BTC case)…"
npm uninstall bitcore-lib-ltc || true

# Optionally build API
if [[ -d "src" ]]; then
  echo "Building TradeLayer API…"
  pushd src >/dev/null
  npm install
  popd >/dev/null
fi

echo "=== Setup complete (Bitcoin, $NETWORK) ==="
echo "RPC: http://$RPC_USER:$RPC_PASS@127.0.0.1:$RPC_PORT/"
echo "Wallet: $WALLET_NAME   Address: $ADDR"

@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ================================
REM CONFIG — edit these as needed
REM ================================
set "PROJECT_ROOT=%~dp0"
set "APP_DIR=%PROJECT_ROOT%node_modules\tradelayer"
set "BTC_VERSION=22.0"
REM NETWORK can be mainnet or testnet
set "NETWORK=mainnet"

REM Simple RPC creds for your algo / core client
set "RPC_USER=user"
set "RPC_PASS=pass"

REM Wallet name
set "WALLET_NAME=mywallet"

REM ================================
REM Derived (do not edit)
REM ================================
if /I "%NETWORK%"=="testnet" (
  set "NET_FLAG=-testnet"
  set "RPC_PORT=18332"
) else (
  set "NET_FLAG="
  set "RPC_PORT=8332"
)

set "BITCOIN_URL=https://bitcoincore.org/bin/bitcoin-core-%BTC_VERSION%/bitcoin-%BTC_VERSION%-win64.zip"
set "ZIP_FILE=%USERPROFILE%\Downloads\bitcoin-%BTC_VERSION%-win64.zip"
set "EXTRACT_DIR=%USERPROFILE%\bitcoin-%BTC_VERSION%"
set "BIN_DIR=%EXTRACT_DIR%\bin"
set "DATADIR=%APPDATA%\Bitcoin"
set "CONF_FILE=%DATADIR%\bitcoin.conf"

echo === Starting setup for TradeLayer (Bitcoin / Windows) ===

REM 0) Project deps
echo.
echo Installing NPM dependencies (project root)...
pushd "%PROJECT_ROOT%"
call npm install || goto :fail
popd

REM 1) Write .env for the tradelayer package (BTC)
echo.
echo Writing .env to "%APP_DIR%\.env" ...
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
(
  echo CHAIN=BTC
  echo RPC_HOST=127.0.0.1
  echo RPC_PORT=%RPC_PORT%
  echo RPC_USER=%RPC_USER%
  echo RPC_PASS=%RPC_PASS%
  echo AUTODETECT=0
  echo TIMEOUT_MS=60000
) > "%APP_DIR%\.env"
echo Done.

REM 2) Fetch & install Bitcoin Core
echo.
echo Fetching Bitcoin Core v%BTC_VERSION% for Win64 ...
if not exist "%ZIP_FILE%" (
  powershell -NoProfile -Command "Invoke-WebRequest -Uri '%BITCOIN_URL%' -OutFile '%ZIP_FILE%'" || goto :fail
) else (
  echo Zip already present at %ZIP_FILE%
)

echo Extracting Bitcoin Core to "%EXTRACT_DIR%" ...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%EXTRACT_DIR%'" || goto :fail

REM 3) Write bitcoin.conf
echo.
echo Configuring %CONF_FILE% ...
if not exist "%DATADIR%" mkdir "%DATADIR%"

REM Create/overwrite minimal config with prune and rpc creds
(
  echo server=1
  echo prune=2000
  echo txindex=0
  echo dbcache=450
  echo rpcuser=%RPC_USER%
  echo rpcpassword=%RPC_PASS%
  if /I "%NETWORK%"=="testnet" (
    echo [test]
    echo rpcport=%RPC_PORT%
  ) else (
    echo [main]
    echo rpcport=%RPC_PORT%
  )
) > "%CONF_FILE%"
echo Wrote %CONF_FILE%

REM 4) Start bitcoind (note: no -daemon on Windows; use 'start')
echo.
echo Starting bitcoind (%NETWORK%) ...
REM Stop any stray instance
"%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% stop >nul 2>&1
REM Give it a moment
timeout /t 2 /nobreak >nul

start "" "%BIN_DIR%\bitcoind.exe" %NET_FLAG%

REM 5) Wait until RPC is ready
echo Waiting for bitcoind RPC @ 127.0.0.1:%RPC_PORT% ...
:waitrpc
"%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% -rpcconnect=127.0.0.1 -rpcport=%RPC_PORT% -rpcuser="%RPC_USER%" -rpcpassword="%RPC_PASS%" getblockchaininfo >nul 2>&1
if errorlevel 1 (
  echo   ... still initializing, retrying in 5s
  timeout /t 5 /nobreak >nul
  goto :waitrpc
)
echo bitcoind is ready.

REM 6) Create or load wallet; print a new address
echo.
echo Preparing wallet: %WALLET_NAME%
REM Is it already loaded?
for /f "usebackq tokens=*" %%A in (`"%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% -rpcport=%RPC_PORT% -rpcuser="%RPC_USER%" -rpcpassword="%RPC_PASS%" listwallets 2^>nul`) do set "WALLETS=%%A"
echo %WALLETS% | find /I "\"%WALLET_NAME%\"" >nul
if errorlevel 1 (
  REM Not loaded — does it exist on disk?
  for /f "usebackq tokens=*" %%B in (`"%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% -rpcport=%RPC_PORT% -rpcuser="%RPC_USER%" -rpcpassword="%RPC_PASS%" listwalletdir 2^>nul`) do set "WALLETDIR=%%B"
  echo %WALLETDIR% | find /I "\"%WALLET_NAME%\"" >nul
  if errorlevel 1 (
    echo Creating new wallet ...
    "%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% -rpcport=%RPC_PORT% -rpcuser="%RPC_USER%" -rpcpassword="%RPC_PASS%" createwallet "%WALLET_NAME%" >nul
  ) else (
    echo Loading existing wallet ...
    "%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% -rpcport=%RPC_PORT% -rpcuser="%RPC_USER%" -rpcpassword="%RPC_PASS%" loadwallet "%WALLET_NAME%" >nul
  )
) else (
  echo Wallet already loaded.
)

echo.
echo Generating a new bech32 address ...
for /f "usebackq tokens=*" %%C in (`"%BIN_DIR%\bitcoin-cli.exe" %NET_FLAG% -rpcport=%RPC_PORT% -rpcuser="%RPC_USER%" -rpcpassword="%RPC_PASS%" -rpcwallet="%WALLET_NAME%" getnewaddress "" bech32 2^>nul`) do set "ADDR=%%C"
echo Wallet address: %ADDR%

REM 7) Append address to .env
echo.
echo Appending USER_ADDRESS to .env ...
>> "%APP_DIR%\.env" echo USER_ADDRESS=%ADDR%
echo Done.

REM 8) (Optional) start your app
echo.
echo Starting your app (npm start) ...
pushd "%PROJECT_ROOT%"
call npm start
popd

echo.
echo === Setup complete (Bitcoin / %NETWORK%) ===
echo RPC: http://%RPC_USER%:%RPC_PASS%@127.0.0.1:%RPC_PORT%/
echo Wallet: %WALLET_NAME%   Address: %ADDR%
goto :eof

:fail
echo.
echo *** ERROR: Setup failed. See messages above. ***
exit /b 1

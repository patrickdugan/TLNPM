#!/bin/bash

# Print a message to the user
echo "Starting setup for TradeLayer environment..."

# Install npm dependencies (for the NPM package)
echo "Installing NPM dependencies..."
npm install

# Fetch litecoind binaries from official Litecoin GitHub
echo "Fetching litecoind binaries..."
LITECOIN_VERSION=0.21.3
wget https://download.litecoin.org/litecoin-${LITECOIN_VERSION}/linux/litecoin-${LITECOIN_VERSION}-x86_64-linux-gnu.tar.gz

# Extract the downloaded binaries
echo "Extracting litecoind binaries..."
tar -xzf litecoin-${LITECOIN_VERSION}-x86_64-linux-gnu.tar.gz
mv litecoin-${LITECOIN_VERSION} ~/litecoin

# Check if litecoin.conf exists, if not create it
chmod 755 $HOME/.litecoin
LITECOIN_CONF_DIR="$HOME/.litecoin"  # Replace ~ with $HOME to ensure the correct home directory is used
LITECOIN_CONF_FILE=$LITECOIN_CONF_DIR/litecoin.conf

echo "Checking for litecoin.conf at: $LITECOIN_CONF_FILE"

if [ ! -f "$LITECOIN_CONF_FILE" ]; then
    echo "Creating litecoin.conf file..."
    mkdir -p "$LITECOIN_CONF_DIR"  # Ensure the directory is created
    echo "rpcuser=user" > "$LITECOIN_CONF_FILE"
    echo "rpcpassword=pass" >> "$LITECOIN_CONF_FILE"
    echo "rpcallowip=127.0.0.1" >> "$LITECOIN_CONF_FILE"
    echo "rpcport=18322" >> "$LITECOIN_CONF_FILE"
    echo "testnet=1" >> "$LITECOIN_CONF_FILE"
    echo "txindex=1" >> "$LITECOIN_CONF_FILE" 
    echo "litecoin.conf created successfully."
else
    echo "litecoin.conf already exists."
fi

# Clone the TradeLayer.js repository if it doesn't exist
echo "Checking for TradeLayer.js directory..."
if [ ! -d "tradelayer.js" ]; then
    echo "Cloning TradeLayer.js repository..."
    git clone https://github.com/patrickdugan/tradelayer.js.git
else
    echo "TradeLayer.js directory already exists."
fi

# Navigate to the TradeLayer directory
cd tradelayer.js

# Check out the txIndexRefactor branch
echo "Checking out the txIndexRefactor branch..."
git checkout txIndexRefactor

# Start litecoind from the bin folder
echo "Starting litecoind..."
~/litecoin/bin/litecoind -daemon -server -testnet -rpcuser=user -rpcpassword=pass -rpcport=18332

# Function to check if litecoind is ready
check_litecoind() {
    while true; do
        sleep 10  # Wait before checking again
        response=$(~/litecoin/bin/litecoin-cli -testnet -rpcport=18332 getblockchaininfo 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            echo "litecoind is ready."
            break
        else
            echo "Waiting for litecoind to initialize..."
        fi
    done
}

# Wait for litecoind to be ready
check_litecoind

# Check if the wallet exists, if not create a new wallet
WALLET_NAME="mywallet"  # You can customize the wallet name here
WALLET_FILE="$HOME/.litecoin/$WALLET_NAME"

echo "Checking for existing wallet at: $WALLET_FILE"
if [ ! -f "$WALLET_FILE" ]; then
    echo "Creating new wallet..."
    ~/litecoin/bin/litecoin-cli -rpcport=18332  createwallet "$WALLET_NAME"

else
    echo "Wallet already exists, loading wallet..."
    ~/litecoin/bin/litecoin-cli -rpcport=18332 loadwallet "$WALLET_NAME"
fi

# Create a wallet address
echo "Creating wallet address..."
address=$(~/litecoin/bin/litecoin-cli -testnet -rpcport=18332  getnewaddress)
echo "Wallet address created: $address"

# Update .env file
ENV_FILE="./.env"  # Specify the .env file path

# Check if the .env file exists, if not create it
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env file..."
    touch "$ENV_FILE"
fi

echo "Updating .env file..."
echo "USER_ADDRESS=$address" >> "$ENV_FILE"
echo ".env file updated successfully."

# Build TradeLayer API
echo "Building TradeLayer API..."
cd src
npm install  # Ensure dependencies are installed
cd ..

echo "Setup complete!"

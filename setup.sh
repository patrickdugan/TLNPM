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
LITECOIN_CONF_DIR=~/.litecoin
LITECOIN_CONF_FILE=$LITECOIN_CONF_DIR/litecoin.conf

if [ ! -f "$LITECOIN_CONF_FILE" ]; then
    echo "Creating litecoin.conf file..."
    mkdir -p $LITECOIN_CONF_DIR
    echo "rpcuser=user" > $LITECOIN_CONF_FILE
    echo "rpcpassword=pass" >> $LITECOIN_CONF_FILE
    echo "rpcallowip=127.0.0.1" >> $LITECOIN_CONF_FILE
else
    echo "litecoin.conf already exists."
fi

# Clone the TradeLayer.js repository
echo "Cloning TradeLayer.js repository..."
git clone https://github.com/patrickdugan/tradelayer.js.git

# Check out the txIndexRefactor branch
echo "Checking out the txIndexRefactor branch..."
cd $TRADELAYER_DIR
git checkout txIndexRefactor

# Build TradeLayer API
echo "Building TradeLayer API..."
cd tradelayer.js/src
npm install  # Ensure dependencies are installed
cd ../..

# Start litecoind from the bin folder
echo "Starting litecoind..."
~/litecoin/bin/litecoind -daemon -server -testnet -conf=$LITECOIN_CONF_FILE 

# Wait for litecoind to start
echo "Waiting for litecoind to initialize..."
sleep 50


echo "Setup complete!"

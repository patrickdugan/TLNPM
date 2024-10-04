#!/bin/bash

# Check if Litecoin daemon is running
if ! pgrep litecoind > /dev/null
then
    echo "Litecoind is not running. Please start the Litecoin daemon first."
    exit 1
fi

# Create a new Litecoin address
ADDRESS=$(litecoin-cli -conf=litecoin.conf getnewaddress)

# Validate the address and retrieve the public key (pubkey)
PUBKEY=$(litecoin-cli -conf=litecoin.conf validateaddress "$ADDRESS" | jq -r '.pubkey')

# Check if pubkey was retrieved
if [ -z "$PUBKEY" ]; then
  echo "Error: Could not retrieve the public key. Ensure the address belongs to the local wallet."
  exit 1
fi

# Write the address and public key to the .env file
echo "USER_ADDRESS=$ADDRESS" > .env
echo "USER_PUBKEY=$PUBKEY" >> .env

echo "Address and public key have been saved to .env"

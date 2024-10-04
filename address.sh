#!/bin/bash

# Generate a new Litecoin address
ADDRESS=$(litecoin-cli -conf=litecoin.conf getnewaddress)

# Check if the address generation was successful
if [ -z "$ADDRESS" ]; then
    echo "Error: Failed to generate a new address."
    exit 1
fi

# Create a .env file if it doesn't exist
if [ ! -f .env ]; then
    touch .env
fi

# Write the generated address to the .env file
echo "USER_ADDRESS=$ADDRESS" > .env

echo "New address $ADDRESS saved to .env file."

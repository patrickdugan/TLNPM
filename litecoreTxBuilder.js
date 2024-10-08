const litecore = require('litecore-lib');
const litecoinClient = require('./litecoinClient.js')
const util = require('util')

const client = litecoinClient()

const signrawtransactionwithwalletAsync = util.promisify(client.cmd.bind(client, 'signrawtransactionwithwallet'));

// Function to build and sign Litecoin transaction
const buildLitecoinTransaction = async (trade, buyerKeyPair, sellerKeyPair, commitUTXOs) => {
    try {
        const { amountForSale, satsExpected } = trade;

        const transaction = new litecore.Transaction();

        // Add inputs (UTXOs)
        commitUTXOs.forEach(utxo => {
            transaction.from({
                txId: utxo.txid,
                outputIndex: utxo.vout,
                script: utxo.scriptPubKey,
                satoshis: utxo.amount * 1e8
            });
        });

        // Add outputs (to seller and change back to buyer)
        transaction.to(sellerKeyPair.address, satsExpected * 1e8)
                   .change(buyerKeyPair.address);

        // Serialize transaction to raw hex
        const rawTxHex = transaction.serialize();

        // Sign the transaction using the Litecoin wallet
        const signResult = await signrawtransactionwithwalletAsync(rawTxHex);
        if (!signResult || !signResult.hex) {
            throw new Error('Signing transaction failed');
        }

        return signResult.hex;
    } catch (error) {
        throw new Error(`Litecoin Transaction Build Error: ${error.message}`);
    }
};

// Function to build and sign Token Trade transaction
const buildTokenTradeTransaction = async (trade, buyerKeyPair, sellerKeyPair, commitUTXOs, payload) => {
    try {
        const transaction = new litecore.Transaction();

        // Add inputs (UTXOs)
        commitUTXOs.forEach(utxo => {
            transaction.from({
                txId: utxo.txid,
                outputIndex: utxo.vout,
                script: utxo.scriptPubKey,
                satoshis: utxo.amount * 1e8
            });
        });

        // Add outputs (token trade via OP_RETURN)
        transaction.addData(payload);

        // Serialize transaction to raw hex
        const rawTxHex = transaction.serialize();

        // Sign the transaction using the Litecoin wallet
        const signResult = await signrawtransactionwithwalletAsync(rawTxHex);
        if (!signResult || !signResult.hex) {
            throw new Error('Signing transaction failed');
        }

        return signResult.hex;
    } catch (error) {
        throw new Error(`Token Trade Transaction Build Error: ${error.message}`);
    }
};

// Function to build and sign Futures Transaction
const buildFuturesTransaction = async (trade, buyerKeyPair, sellerKeyPair, commitUTXOs, payload) => {
    try {
        const transaction = new litecore.Transaction();

        // Add inputs (UTXOs)
        commitUTXOs.forEach(utxo => {
            transaction.from({
                txId: utxo.txid,
                outputIndex: utxo.vout,
                script: utxo.scriptPubKey,
                satoshis: utxo.amount * 1e8
            });
        });

        // Add outputs (futures trade via OP_RETURN)
        transaction.addData(payload);

        // Serialize transaction to raw hex
        const rawTxHex = transaction.serialize();

        // Sign the transaction using the Litecoin wallet
        const signResult = await signrawtransactionwithwalletAsync(rawTxHex);
        if (!signResult || !signResult.hex) {
            throw new Error('Signing transaction failed');
        }

        return signResult.hex;
    } catch (error) {
        throw new Error(`Futures Transaction Build Error: ${error.message}`);
    }
};

// Function to extract UTXO from commit transaction
const getUTXOFromCommit = async (rawtx, multySigChannelData) => {
    try {
        const decodedTx = await litecoinClient.decodeRawTransaction(rawtx);
        if (!decodedTx || !decodedTx.vout) throw new Error('Failed to decode raw transaction');

        const vout = decodedTx.vout.find(output => output.scriptPubKey.addresses[0] === multySigChannelData?.address);
        if (!vout) throw new Error('UTXO for multisig address not found');

        return {
            amount: vout.value,
            vout: vout.n,
            txid: decodedTx.txid,
            scriptPubKey: multySigChannelData.scriptPubKey,
            redeemScript: multySigChannelData.redeemScript,
        };
    } catch (error) {
        throw new Error(`getUTXOFromCommit Error: ${error.message}`);
    }
};

module.exports = {
    buildLitecoinTransaction,
    buildTokenTradeTransaction,
    buildFuturesTransaction,
    getUTXOFromCommit
};

const litecore = require('bitcore-lib-ltc');
const litecoinClient = require('./litecoinClient.js')
const util = require('util')
//const BigNumber = require('BigNumber')
const client = litecoinClient()

const getRawTransactionAsync = util.promisify(client.getRawTransaction.bind(client));
const getBlockDataAsync = util.promisify(client.getBlock.bind(client));
const createRawTransactionAsync = util.promisify(client.createRawTransaction.bind(client));
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client,'sendrawtransaction'));
const validateAddress = util.promisify(client.cmd.bind(client,'validateaddress'));
const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'));
const loadWalletAsync = util.promisify(client.cmd.bind(client, 'loadwallet'));
const addMultisigAddressAsync = util.promisify(client.cmd.bind(client, 'addmultisigaddress'));
const signrawtransactionwithwalletAsync = util.promisify(client.cmd.bind(client, 'signrawtransactionwithwallet'));

// Function to build and sign Litecoin transaction
const buildLitecoinTransaction = async (txConfig, isApiMode=false) => {
    try {
        const { buyerKeyPair, sellerKeyPair, satsExpected, payload, commitUTXOs, network='ltc' } = txConfig;
        const buyerAddress = buyerKeyPair.address;
        const sellerAddress = sellerKeyPair.address;

        // Fetch unspent UTXOs for the buyer
        const luRes = await listUnspentAsync(); // Fetch unspent UTXOs for the buyer
        console.log(JSON.stringify(luRes))

        const _utxos = luRes.data
            .map(i => ({ ...i, pubkey: buyerKeyPair.pubkey }))
            .sort((a, b) => b.amount - a.amount); // Sorting UTXOs by amount (descending)

        // Merge buyer UTXOs with commitUTXOs
        const utxos = [...commitUTXOs, ..._utxos];

        // Use hardcoded minimum output amount (adjust based on your system's needs)
        const minAmount = 0.000056; // Example value

        const buyerLtcAmount = minAmount;
        const sellerLtcAmount = Math.max(amount, minAmount); // Ensure seller receives enough LTC
        const minAmountForAllOuts = buyerLtcAmount + sellerLtcAmount;

        // Select the UTXOs that cover the required amounts
        const inputsRes = getEnoughInputs2(utxos, minAmountForAllOuts);
        const { finalInputs, fee } = inputsRes;

        const _inputsSum = finalInputs.map(({ amount }) => amount).reduce((a, b) => a + b, 0);
        const inputsSum = _inputsSum;

        // Calculate change for buyer and ensure sufficient funds
        const changeBuyerLtcAmount = Math.max(inputsSum - sellerLtcAmount - fee, buyerLtcAmount);
        if (inputsSum < fee + sellerLtcAmount + changeBuyerLtcAmount) return new Error("Not Enough coins for paying fees.");

        // Prepare the raw transaction inputs and outputs
        const _insForRawTx = finalInputs.map(({ txid, vout }) => ({ txid, vout }));
        const _outsForRawTx = {
            [buyerAddress]: changeBuyerLtcAmount,
            [sellerAddress]: sellerLtcAmount
        };

        // Create the raw transaction
        const crtRes = await createRawTransactionAsync([_insForRawTx, _outsForRawTx]);
        if (crtRes.error || !crtRes.data) return new Error(`createrawtransaction: ${crtRes.error}`);

        // Add OP_RETURN with the payload data
        const crtxoprRes = new litecore.Transaction(crtRes.data).addData(payload);
        if (crtxoprRes.error || !crtxoprRes.data) return new Error(`tl_createrawtx_opreturn: ${crtxoprRes.error}`);

        const finalTx = crtxoprRes.data;

        // Prepare the PSBT hex config
        const psbtHexConfig = {
            rawtx: finalTx,
            inputs: finalInputs,
            network: network
        };

        // Build the PSBT using bitcoinjs-lib
        const psbtHexRes = await buildPsbt(psbtHexConfig);
        if (psbtHexRes.error || !psbtHexRes.data) return new Error(`buildPsbt: ${psbtHexRes.error}`);

        const data = { rawtx: finalTx, inputs: finalInputs, psbtHex: psbtHexRes.data };
        return { data };

    } catch (error) {
        console.error('Error building Litecoin transaction:', error);
        return { error: error.message || 'Error building transaction' };
    }
};

const buildPsbt = (buildPsbtOptions) => {
    try {
        const { rawtx, inputs, network } = buildPsbtOptions;
        const _network = networks[network];

        const tx = Transaction.fromHex(rawtx);
        const psbt = new Psbt({ network: _network });

        inputs.forEach((input) => {
            const hash = input.txid;
            const index = input.vout;
            const value = safeNumber(input.amount * (10 ** 8), 0);
            const script = Buffer.from(input.scriptPubKey, 'hex');
            const witnessUtxo = { script, value };
            const inputObj = { hash, index, witnessUtxo };

            if (input.redeemScript) inputObj.witnessScript = Buffer.from(input.redeemScript, 'hex');
            psbt.addInput(inputObj);
        });

        // Add outputs (sending to buyer and seller)
        tx.outs.forEach((output) => {
            psbt.addOutput(output);
        });

        const psbtHex = psbt.toHex();
        return { data: psbtHex };

    } catch (error) {
        console.error('Error building PSBT:', error.message);
        return { error: error.message };
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

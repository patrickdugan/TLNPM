const litecore = require('bitcore-lib-ltc');
const litecoinClient = require('./litecoinClient.js')
const util = require('util')
const BigNumber = require('bignumber.js');
const client = litecoinClient()
const { payments, Psbt, Transaction } = require('bitcoinjs-lib');

const getRawTransactionAsync = util.promisify(client.getRawTransaction.bind(client));
const getBlockDataAsync = util.promisify(client.getBlock.bind(client));
const createRawTransactionAsync = util.promisify(client.cmd.bind(client,'createrawtransaction'));
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client,'sendrawtransaction'));
const validateAddress = util.promisify(client.cmd.bind(client,'validateaddress'));
const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'));
const loadWalletAsync = util.promisify(client.cmd.bind(client, 'loadwallet'));
const addMultisigAddressAsync = util.promisify(client.cmd.bind(client, 'addmultisigaddress'));
const signrawtransactionwithwalletAsync = util.promisify(client.cmd.bind(client, 'signrawtransactionwithwallet'));

const minFeeLtcPerKb = 0.00002
// Function to build and sign Litecoin transaction
const buildLitecoinTransaction = async (txConfig, isApiMode=false) => {
    //try {
        const { buyerKeyPair, sellerKeyPair, amount, payload, commitUTXOs, network='ltc' } = txConfig;
        const buyerAddress = buyerKeyPair.address;
        const sellerAddress = sellerKeyPair.address;

        // Fetch unspent UTXOs for the buyer
        const luRes = await listUnspentAsync(); // Fetch unspent UTXOs for the buyer
        console.log(JSON.stringify(luRes))

        const _utxos = luRes.map(i => ({ ...i, pubkey: buyerKeyPair.pubkey }))
            .sort((a, b) => b.amount - a.amount); // Sorting UTXOs by amount (descending)

        // Merge buyer UTXOs with commitUTXOs
        const utxos = [...commitUTXOs, ..._utxos];
        console.log(JSON.stringify(utxos))
        // Use hardcoded minimum output amount (adjust based on your system's needs)
        const minAmount = 0.000056; // Example value

        const buyerLtcAmount = minAmount;
        const sellerLtcAmount = Math.max(amount, minAmount); // Ensure seller receives enough LTC
        const minAmountForAllOuts = buyerLtcAmount + sellerLtcAmount;

        // Select the UTXOs that cover the required amounts
        const inputsRes = getEnoughInputs2(utxos, minAmountForAllOuts);
        const { finalInputs, fee } = inputsRes;
        console.log('input filter '+JSON.stringify(inputsRes)+' '+fee)
        const _inputsSum = finalInputs.map(({ amount }) => amount).reduce((a, b) => a + b, 0);
        const inputsSum = _inputsSum;

        // Calculate change for buyer and ensure sufficient funds
        const changeBuyerLtcAmount = Math.max(inputsSum - sellerLtcAmount - fee, buyerLtcAmount);
        if (inputsSum < fee + sellerLtcAmount + changeBuyerLtcAmount) return new Error("Not Enough coins for paying fees.");
        const hexPayload = Buffer.from(payload, 'utf8').toString('hex');
        // Prepare the raw transaction inputs and outputs
        const _insForRawTx = finalInputs.map(({ txid, vout/*, scriptPubKey*/ }) => ({ txid, vout/*, scriptPubKey */}));
        const _outsForRawTx = [
            {[buyerAddress]: changeBuyerLtcAmount},
            {[sellerAddress]: sellerLtcAmount},
            {'data':hexPayload}
        ];

        console.log('inputs for create raw tx '+JSON.stringify(_insForRawTx)+' outs '+JSON.stringify(_outsForRawTx))
        // Create the raw transaction
        let crtRes = await createRawTransactionAsync(_insForRawTx, _outsForRawTx);
        //if (crtRes.error || !crtRes.data) return new Error(`createrawtransaction: ${crtRes.error}`);
        console.log('built tx '+JSON.stringify(crtRes))

        const finalTx = crtRes //crtxoprRes.data;

        // Prepare the PSBT hex config
        const psbtHexConfig = {
            rawtx: finalTx,
            inputs: finalInputs
        };

        // Build the PSBT using bitcoinjs-lib
        const psbtHexRes = await buildPsbt(psbtHexConfig);
        if (psbtHexRes.error || !psbtHexRes.data) return new Error(`buildPsbt: ${psbtHexRes.error}`);

        const data = { rawtx: finalTx, inputs: finalInputs, psbtHex: psbtHexRes.data };
        return { data };
    //} catch (error) {
        //console.error('Error building Litecoin transaction:', error);
        //return { error: error.message || 'Error building transaction' };
    //}
};

const buildPsbt = (buildPsbtOptions) => {
    //try {
        const { rawtx, inputs } = buildPsbtOptions;

        const tx = Transaction.fromHex(rawtx);
        const psbt = new Psbt({ network: 'LTCTEST' });

        inputs.forEach((input) => {
            const hash = input.txid;
            const index = input.vout;
            const value = BigInt(new BigNumber(input.amount).times(1e8).toString());  // Use BigInt for value
            const script = Uint8Array.from(Buffer.from(input.scriptPubKey, 'hex')); // Convert script to Uint8Array

            const witnessUtxo = { script, value };  // Construct the witnessUtxo object with correct types
            const inputObj = { hash, index, witnessUtxo };

            //console.log('psbt inputs ' + JSON.stringify(inputObj));

            if (input.redeemScript) inputObj.witnessScript = Uint8Array.from(Buffer.from(input.redeemScript, 'hex'));
            
            psbt.addInput(inputObj);
        });
       // Add outputs (sending to buyer and seller)
        tx.outs.forEach((output) => {
            psbt.addOutput(output);
        });

        const psbtHex = psbt.toHex();
        return { data: psbtHex };

    //} catch (error) {
    //   console.error('Error building PSBT:', error.message);
    //    return { error: error.message };
    //}
};

const getEnoughInputs = (_inputs, amount) => {
    const finalInputs = [];
    _inputs.forEach(u => {
        const _amountSum = finalInputs.map(r => new BigNumber(r.amount)).reduce((a, b) => a.plus(b), new BigNumber(0)); // Sum inputs using BigNumber
        const amountSum = _amountSum.toNumber(); // Convert back to regular number
        if (amountSum < new BigNumber(amount).toNumber()) finalInputs.push(u);  // Adds inputs until the sum reaches 'amount'
    });
    const fee = new BigNumber(0.2 * minFeeLtcPerKb).times(finalInputs.length).toNumber();  // Fee based on selected inputs
    return { finalInputs, fee };
};

const getEnoughInputs2 = (_inputs, amount) => {
    const finalInputs = [];
    _inputs.forEach(u => {
        const _amountSum = finalInputs.map(r => new BigNumber(r.amount)).reduce((a, b) => a.plus(b), new BigNumber(0)); // Sum inputs using BigNumber
        const amountSum = _amountSum.toNumber(); // Convert back to regular number
        const _fee = new BigNumber(0.2 * minFeeLtcPerKb).times(finalInputs.length + 1).toNumber(); // Fee based on number of inputs
        if (amountSum < new BigNumber(amount).plus(_fee).toNumber()) finalInputs.push(u);  // Adds inputs until we cover 'amount + fee'
    });
    const fee = new BigNumber(0.2 * minFeeLtcPerKb).times(finalInputs.length).toNumber();  // Fee based on final inputs
    return { finalInputs, fee };
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

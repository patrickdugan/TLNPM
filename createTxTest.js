const createclient = require('tradelayer/litecoinClient.js');  // Adjust the path if necessary

// Initialize the Litecoin client
const client = createclient(true);  // Pass 'true' for testnet, 'false' for mainnet

// Promisify the necessary client functions
const createRawTransactionAsync = require('util').promisify(client.createRawTransaction.bind(client));

const testTransaction = async () => {
    //try {
        // Example JSON that can be pasted in, replace with your transaction details
        const inputs = [{"txid":"f4e70867d6a0517686b6534b1109eb393968c7a3cbc34798682d6dbffe46d211","vout":0/*,"scriptPubKey":"0020a30d39561520a26d39248fb24062bb1997df52e8b73a22828534e9d58ecd58ff"*/},{"txid":"96b7e27670792dc40e45cbe3677592fe95af431325b186e81b81a8f40d39a4d7","vout":0/*,"scriptPubKey":"0014f94801072fc65f8c35db2363f75803f16a9da94b"*/}]
        const outputs = [{"tltc1ql9yqzpe0ce0ccdwmyd3lwkqr794fm22tmhe7mn":0.0044946},{"tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t":0.0001}]
        // Call getRawTransaction with the provided parameters
        const rawTx = await createRawTransactionAsync(inputs,outputs);

        // Log the raw transaction result
        console.log("Raw Transaction Result: ", rawTx);

    //} catch (error) {
    //    console.error("Error fetching raw transaction:", error.message);
    //}
};

// Run the test
testTransaction();

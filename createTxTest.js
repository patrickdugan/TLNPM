const createclient = require('tradelayer/litecoinClient.js');  // Adjust the path if necessary

// Initialize the Litecoin client
const client = createclient(true);  // Pass 'true' for testnet, 'false' for mainnet

// Promisify the necessary client functions
const createRawTransactionAsync = require('util').promisify(client.createRawTransaction.bind(client));

const testTransaction = async () => {
    //try {
        // Example JSON that can be pasted in, replace with your transaction details
        const inputs = [{"txid":"3b4546ad93a7d77ee684ec1ae01ad7eb3f67183459cd41da92ed0f1940eba1f1","vout":0},{"txid":"bc395db7a7a11b42e9711e192a860da2fffe64955cae6dd673e267532f328b3d","vout":1}] 
        const outputs = [{"tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8":0.02920059},{"tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t":0.0001},{"data":"746c33302c302e3030346e796d386571756170712c302c3770732c302c312c30"}]
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

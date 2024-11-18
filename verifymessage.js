const litecoinClient = require('./litecoinClient');  // Adjust path if necessary

/**
 * Promisified version of the verifymessage RPC call
 * @param {string} address - The address that signed the message.
 * @param {string} signature - The signature to verify.
 * @param {string} message - The original message that was signed.
 * @returns {Promise<boolean>} - Resolves to `true` if signature is valid, `false` otherwise.
 */
const verifyMessageAsync = util.promisify(client.cmd.bind(client,'verifymessage'));

const verifySignature = async (address, signature, message) => {
    try {
        // Making the RPC call using litecoinClient
        const result = await verifymessageAsync([address, signature, message]);

        // Check if the result is true (valid signature)
        if (result === true) {
            console.log(`Signature is valid for address: ${address}`);
            return true;
        } else {
            console.log(`Signature is invalid for address: ${address}`);
            return false;
        }
    } catch (error) {
        console.error(`Error verifying signature: ${error}`);
        return false;
    }
};

// Example Usage
(async () => {
    const address = 'tltc1ql9yqzpe0ce0ccdwmyd3lwkqr794fm22tmhe7mn';
    const signature = 'H1t+P0w0u1kQOpS7LCUsTtT...';  // Example signature
    const message = 'Hello, Litecoin!';
    
    await verifySignature(address, signature, message);
})();

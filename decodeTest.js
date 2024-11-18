const { Psbt } = require('bitcoinjs-lib');
const { ECPair } = require('bitcoinjs-lib');
const { payments } = require('bitcoinjs-lib');
const { Buffer } = require('buffer');

// Example PSBT object (this should be replaced with your actual PSBT data)
const psbtHex = "70736274ff0100c50200000002343025a90f60c20c72637d18c3dcf46dd31b7e1abe409982c1daa3f1753f6b060000000000ffffffffd7a4390df4a8811be886b1251343af95fe927567e3cb450ec42d797076e2b7960000000000ffffffff03b4db060000000000160014f94801072fc65f8c35db2363f75803f16a9da94b1027000000000000160014396d64761fb3feb3fcaf95bf1c21c8f36d680a7e0000000000000000226a20746c33302c302e3030346e796d386571756170712c302c3770732c302c312c30000000000001012b5415000000000000220020a30d39561520a26d39248fb24062bb1997df52e8b73a22828534e9d58ecd58ff220203f9967f334d7bcbe7bcefa41252ba488c3ceadf6da6c269bcada1ed0b9d600a5047304402205d097e72787447472f8b3edee44067c7ac313421725eb2b884fe01d7e6a3352a02200592f4809141b1c1fccaf900c351797ba8f8d7425298257967509e7f6668afc201010547522103f9967f334d7bcbe7bcefa41252ba488c3ceadf6da6c269bcada1ed0b9d600a5021035d0c4cf2ea856bef98dba896f7e82bd9d80cedd08d117253e9ce225079f72b4b52ae0001011f90f0060000000000160014f94801072fc65f8c35db2363f75803f16a9da94b00000000"
// Decode the PSBT
const psbt = Psbt.fromHex(psbtHex);

// Check all inputs and their validity
psbt.data.inputs.forEach((input, index) => {
    console.log(`Analyzing input ${index + 1} - TXID: ${input.txid}`);

    // Check witness script
    if (input.witnessUtxo && input.witnessUtxo.script) {
        const witnessScript = input.witnessUtxo.script;
        console.log(`Witness script for input ${index + 1}: `, witnessScript.toString('hex'));

        // If it's multisig, it should match the expected structure
        if (input.witnessScript) {
            const isMultisig = witnessScript[0] === 0x52; // 0x52 is the OP_CHECKMULTISIG opcode
            if (isMultisig) {
                console.log("This input is a multisig input.");
                // Decode and check public keys in multisig (optional)
            } else {
                console.log("This input is not a multisig input.");
            }
        }
    }

    // Verify the signatures
    if (input.partialSig) {
        input.partialSig.forEach((sigData, sigIndex) => {
            const pubkey = sigData.pubkey.toString('hex');
            const signature = sigData.signature.toString('hex');
            console.log(`Signature ${sigIndex + 1} for input ${index + 1}:`);
            console.log(`Pubkey: ${pubkey}`);
            console.log(`Signature: ${signature}`);
        });
    }
});

// Check all outputs
psbt.data.outputs.forEach((output, index) => {
    console.log(`Analyzing output ${index + 1} - Value: ${output.value}`);

    const script = output.script;
    console.log(`Output scriptPubKey for output ${index + 1}: `, script.toString('hex'));

    // Check if it's a P2WPKH or P2PKH output
    const p2wpkh = payments.p2wpkh({ output: script });
    const p2pkh = payments.p2pkh({ output: script });

    if (p2wpkh) {
        console.log("This is a P2WPKH output.");
    } else if (p2pkh) {
        console.log("This is a P2PKH output.");
    } else {
        console.log("This is an unknown output type.");
    }
});

// Check that the PSBT is finalized (signed)
if (psbt.finalized) {
    console.log("PSBT is finalized (signed).");
} else {
    console.log("PSBT is not finalized. It may still need signing.");
}

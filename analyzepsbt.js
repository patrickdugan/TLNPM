const { Psbt, payments } = require('bitcoinjs-lib');
const {ECPairFactory} = require('ecpair')
const ecc = require('tiny-secp256k1')
const ECPair = ECPairFactory(ecc);
const { Buffer } = require('buffer');

// Helper function to verify signatures
const verifySignature = (pubkeyHex, sigHex, message) => {
    const pubkey = Buffer.from(pubkeyHex, 'hex');
    const signature = Buffer.from(sigHex, 'hex');
    const keyPair = ECPair.fromPublicKey(pubkey);
    
    try {
        const isValid = keyPair.verify(message, signature);
        return isValid;
    } catch (e) {
        console.error('Signature verification failed', e);
        return false;
    }
};

// Example PSBT - Replace with your actual PSBT data
const psbtHex = "70736274ff0100c50200000002343025a90f60c20c72637d18c3dcf46dd31b7e1abe409982c1daa3f1753f6b060000000000ffffffffd7a4390df4a8811be886b1251343af95fe927567e3cb450ec42d797076e2b7960000000000ffffffff03b4db060000000000160014f94801072fc65f8c35db2363f75803f16a9da94b1027000000000000160014396d64761fb3feb3fcaf95bf1c21c8f36d680a7e0000000000000000226a20746c33302c302e3030346e796d386571756170712c302c3770732c302c312c30000000000001012b5415000000000000220020a30d39561520a26d39248fb24062bb1997df52e8b73a22828534e9d58ecd58ff2202035d0c4cf2ea856bef98dba896f7e82bd9d80cedd08d117253e9ce225079f72b4b47304402204092a77ebdb1151a45c431539bf163471b8644f34c0855447d17c46d6e549c10022004f42545960abb8f7dfdb9b9a83ae171231fb34bfc8ebd5f5ca5d83e3ba169cd01220203f9967f334d7bcbe7bcefa41252ba488c3ceadf6da6c269bcada1ed0b9d600a5047304402205d097e72787447472f8b3edee44067c7ac313421725eb2b884fe01d7e6a3352a02200592f4809141b1c1fccaf900c351797ba8f8d7425298257967509e7f6668afc201010547522103f9967f334d7bcbe7bcefa41252ba488c3ceadf6da6c269bcada1ed0b9d600a5021035d0c4cf2ea856bef98dba896f7e82bd9d80cedd08d117253e9ce225079f72b4b52ae0001011f90f0060000000000160014f94801072fc65f8c35db2363f75803f16a9da94b2202035d0c4cf2ea856bef98dba896f7e82bd9d80cedd08d117253e9ce225079f72b4b48304502210095c96ae1bbb0bd91b11658d5263f261e4da61932a5de4826f791f22734e3b233022011372fc7a53a2f0591934f4957372b5f637263fcae4c64c2d2ebf759fe75214f0100000000";

// Decode the PSBT
const psbt = Psbt.fromHex(psbtHex);

// Analyze Inputs and Witness Data
psbt.data.inputs.forEach((input, index) => {
    console.log(`Analyzing input ${index + 1} - TXID: ${input.txid}`);
    
    // Get witness script and witness data
    const witnessScript = input.witnessScript ? input.witnessScript.toString('hex') : null;
    const signatures = input.partialSig || [];

    console.log(`Witness Script: ${witnessScript}`);

    // Verify signatures
    signatures.forEach((sigData, sigIndex) => {
        const pubkeyHex = sigData.pubkey.toString('hex');
        const sigHex = sigData.signature.toString('hex');
        const message = input.txid + input.vout; // Message for signature verification (customize as per your use case)
        
        const isValid = verifySignature(pubkeyHex, sigHex, message);
        console.log(`Signature ${sigIndex + 1} for input ${index + 1} is ${isValid ? 'valid' : 'invalid'}`);
    });
    
    // Check witness UTXO script (e.g., for P2WPKH or multisig)
    if (input.witnessUtxo) {
        const script = input.witnessUtxo.script.toString('hex');
        console.log(`Witness UTXO script: ${script}`);

        // Check if it's a P2WPKH or P2PKH
        const p2wpkh = payments.p2wpkh({ output: Buffer.from(script, 'hex') });
        const p2pkh = payments.p2pkh({ output: Buffer.from(script, 'hex') });

        if (p2wpkh) {
            console.log(`This input is P2WPKH`);
        } else if (p2pkh) {
            console.log(`This input is P2PKH`);
        } else {
            console.log(`This input is an unknown type`);
        }
    }
});

// Check Outputs
psbt.data.outputs.forEach((output, index) => {
    console.log(`Analyzing output ${index + 1} - Value: ${output.value}`);
    
    const script = output.script.toString('hex');
    console.log(`Output scriptPubKey for output ${index + 1}: ${script}`);
    
    // Check if it's P2WPKH or P2PKH
    const p2wpkh = payments.p2wpkh({ output: Buffer.from(script, 'hex') });
    const p2pkh = payments.p2pkh({ output: Buffer.from(script, 'hex') });

    if (p2wpkh) {
        console.log("This is a P2WPKH output.");
    } else if (p2pkh) {
        console.log("This is a P2PKH output.");
    } else {
        console.log("This is an unknown output type.");
    }
});

// Verify finalization of PSBT
if (psbt.finalized) {
    console.log("PSBT is finalized (signed).");
} else {
    console.log("PSBT is not finalized. It may still need signing.");
}

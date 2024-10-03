const BigNumber = require('bignumber.js');

const marker = 'tl';

const Encode = {
    // Encode Simple Token Issue Transaction
    encodeActivateTradeLayer(params) {
        const payload = [
            params.txTypeToActivate.toString(36),
            params.codeHash,
            params.wasmHash
        ];
        const txNumber = 0;  // Example starting tx type number
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Encode Token Issue Transaction
    encodeTokenIssue(params) {
        const payload = [
            params.initialAmount.toString(36),
            params.ticker,
            params.whitelists.map(val => val.toString(36)).join(','),
            params.managed ? '1' : '0',
            params.backupAddress,
            params.nft ? '1' : '0'
        ];
        const txNumber = 1;
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Encode Send Transaction
    encodeSend(params) {
        let payload;
        if (params.sendAll) {
            payload = `1;${params.address}`;
        } else if (Array.isArray(params.propertyId) && Array.isArray(params.amount)) {
            payload = [
                '0', // Not sendAll
                '', // Address omitted for multi-send
                params.propertyId.map(id => this.encodePropertyId(id)).join(','),
                params.amount.map(amt => amt.toString(36)).join(',')
            ].join(';');
        } else {
            const encodedPropertyId = this.encodePropertyId(params.propertyId);
            payload = [
                '0', // Not sendAll
                params.address,
                encodedPropertyId,
                params.amount.toString(36)
            ].join(';');
        }
        const txNumber = 2;
        return marker + txNumber.toString(36) + payload;
    },

    // Helper function to encode property ID
    encodePropertyId(propertyId) {
        if (typeof propertyId === 'string' && propertyId.startsWith('s-')) {
            const [_, collateralId, contractId] = propertyId.split('-');
            const encodedCollateralId = parseInt(collateralId).toString(36);
            const encodedContractId = parseInt(contractId).toString(36);
            return `s-${encodedCollateralId}-${encodedContractId}`;
        } else {
            return propertyId.toString(36);
        }
    },

    // Encode Trade Token for UTXO Transaction
    encodeTradeTokenForUTXO(params) {
        const amount = new BigNumber(params.amountOffered).times(1e8).toString(36);
        const payload = [
            params.propertyId.toString(36),
            amount,
            params.columnA,
            params.satsExpected.toString(36),
            params.tokenOutput,
            params.payToAddress
        ].join(',');
        const txNumber = 3;
        return marker + txNumber.toString(36) + payload;
    },

    // Encode Commit Token Transaction
    encodeCommit(params) {
        const amount = new BigNumber(params.amount).times(1e8).toString(36);
        const channelAddress = params.channelAddress.length > 42 ? `ref:${params.ref || 0}` : params.channelAddress;
        const payload = [
            params.propertyId.toString(36),
            amount,
            channelAddress
        ].join(',');
        const txNumber = 4;
        return marker + txNumber.toString(36) + payload;
    },

    // Encode On-chain Token for Token Transaction
    encodeOnChainTokenForToken(params) {
        const amountOffered = new BigNumber(params.amountOffered).times(1e8).toString(36);
        const amountExpected = new BigNumber(params.amountExpected).times(1e8).toString(36);
        const payload = [
            params.propertyIdOffered.toString(36),
            params.propertyIdDesired.toString(36),
            amountOffered,
            amountExpected,
            params.stop ? '1' : '0',
            params.post ? '1' : '0'
        ].join(',');
        const txNumber = 5;
        return marker + txNumber.toString(36) + payload;
    },

    // Encode Cancel Order Transaction
    encodeCancelOrder(params) {
        let encodedTx = params.isContract ? `1` : `0`;

        if (params.isContract) {
            encodedTx += `,${params.contractId.toString(36)},${params.cancelAll ? 1 : 0}`;
        } else {
            encodedTx += `,${params.offeredPropertyId.toString(36)},${params.desiredPropertyId.toString(36)},${params.cancelAll ? 1 : 0}`;
        }

        if (params.cancelParams && params.cancelParams.price !== undefined) {
            const priceEncoded = params.isContract ? params.cancelParams.price.toString(36) : new BigNumber(params.cancelParams.price).times(8).toString(36);
            encodedTx += `,${priceEncoded},${params.cancelParams.side.toString(36)}`;
        }

        if (params.cancelParams && params.cancelParams.txid) {
            encodedTx += `,${params.cancelParams.txid}`;
        }

        const txNumber = 6;
        return marker + txNumber.toString(36) + encodedTx;
    },

    encodeCreateWhitelist: (params) => {
        const payload = [
            params.backupAddress,
            params.name,
            params.url,
            params.description
        ];
        const txNumber = 7;  // Transaction type 7
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 8: Encode Update Whitelist Admin Transaction
    encodeUpdateAdmin: (params) => {
        const payload = [
            params.newAddress,
            params.whitelist ? '1' : '0',
            params.oracle ? '1' : '0',
            params.token ? '1' : '0',
            params.id.toString(36),
            params.updateBackup ? '1' : '0'
        ];
        const txNumber = 8;  // Transaction type 8
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 9: Encode Issue Attestation Transaction
    encodeIssueOrRevokeAttestation: (params) => {
        const payload = [
            params.revoke,
            params.id,
            params.targetAddress,
            params.metaData
        ];
        const txNumber = 9;  // Transaction type 9
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 10: Encode Revoke Attestation Transaction
    encodeAMMPool: (params) => {
        const payload = [
            params.isRedeem, 
            params.isContract, 
            params.id, 
            params.amount, 
            params.id2, 
            params.amount2,
        ];
        const txNumber = 10;  // Transaction type 10
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 11: Encode Create Oracle Transaction
    encodeCreateOracle: (params) => {
        const payload = [
            params.ticker,
            params.url,
            params.backupAddress,
            params.whitelists.map(whitelist => whitelist.toString(36)).join(','),
            params.lag.toString(36)
        ];
        const txNumber = 11;  // Transaction type 11
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 12: Encode Grant Managed Token Transaction
    encodeGrantManagedToken: (params) => {
        const amountGranted = new BigNumber(params.amountGranted).times(1e8).toString(36);
        const payload = [
            params.propertyid.toString(36),
            amountGranted,
            params.addressToGrantTo
        ];
        const txNumber = 12;  // Transaction type 12
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 13: Encode Redeem Managed Token Transaction
    encodeRedeemManagedToken: (params) => {
        const amountGranted = new BigNumber(params.amountGranted).times(1e8).toString(36);
        const payload = [
            params.propertyid.toString(36),
            amountGranted,
            params.addressToGrantTo
        ];
        const txNumber = 13;  // Transaction type 13
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 14: Encode Publish Oracle Data Transaction
    encodePublishOracleData: (params) => {
        const payload = [
            params.oracleid.toString(36),
            params.price.toString(36)
        ];
        if (params.high !== undefined) {
            payload.push(params.high.toString(36));
        }
        if (params.low !== undefined) {
            payload.push(params.low.toString(36));
        }
        if (params.close !== undefined) {
            payload.push(params.close.toString(36));
        }
        const txNumber = 14;  // Transaction type 14
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 15: Encode Close Oracle Transaction
    encodeCloseOracle: (id) => {
        const txNumber = 15;  // Transaction type 15
        return marker + txNumber.toString(36) + id.toString(36); // No other parameters
    },

    // Transaction type 16: Encode Create Future Contract Series Transaction
    encodeCreateFutureContractSeries: (params) => {
        const payload = [
            params.native ? '1' : '0',
            params.underlyingOracleId.toString(36),
            params.onChainData.map(data => `${data[0].toString(36)}:${data[1].toString(36)}`).join(';'),
            params.notionalPropertyId.toString(36),
            params.notionalValue.toString(36),
            params.collateralPropertyId.toString(36),
            params.leverage,
            params.expiryPeriod !== undefined ? params.expiryPeriod.toString(36) : '0',
            params.series.toString(36),
            params.inverse ? '1' : '0',
            params.fee !== undefined ? params.fee ? '1' : '0' : '0'
        ];
        const txNumber = 16;  // Transaction type 16
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 17: Encode Exercise Derivative Transaction
    encodeExerciseDerivative: (params) => {
        const payload = [
            params.derivativeContractId.toString(36),
            params.amount.toString(36),
        ];
        const txNumber = 17;  // Transaction type 17
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 18: Encode Trade Contract On-chain Transaction
    encodeTradeContractOnchain: (params) => {
        const payload = [
            params.contractId.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.sell ? '1' : '0',
            params.insurance ? '1' : '0',
            params.reduce ? '1' : '0',
            params.post ? '1' : '0',
            params.stop ? '1' : '0'
        ];
        const txNumber = 18;  // Transaction type 18
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 19: Encode Trade Contract in Channel Transaction
    encodeTradeContractChannel: (params) => {
        const payload = [
            params.contractId.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.columnAIsSeller ? '1' : '0',
            params.expiryBlock.toString(36),
            params.insurance ? '1' : '0',
        ];
        const txNumber = 19;  // Transaction type 19
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 20: Encode Trade Tokens in Channel Transaction
    encodeTradeTokensChannel: (params) => {
        const amountOffered = new BigNumber(params.amountOffered1).times(1e8).toNumber();
        const amountDesired = new BigNumber(params.amountDesired2).times(1e8).toNumber();
        const payload = [
            params.propertyId1.toString(36),
            params.propertyId2.toString(36),
            amountOffered.toString(36),
            amountDesired.toString(36),
            params.columnAIsOfferer ? '1' : '0',
            params.expiryBlock.toString(36),
        ];
        const txNumber = 20;  // Transaction type 20
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 21: Encode Withdrawal Transaction
    encodeWithdrawal: (params) => {
        const amounts = new BigNumber(params.amountOffered).times(1e8).toNumber().toString();
        const withdrawAll = params.withdrawAll;
        const propertyIds = params.propertyId.toString(36);
        const column = params.column; // 0 is A, 1 is B
        const payload = [withdrawAll, propertyIds, amounts, column, params.channelAddress];
        const txNumber = 21;  // Transaction type 21
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 22: Encode Transfer Transaction
    encodeTransfer: (params) => {
        const propertyId = params.propertyId.toString(36);
        const amounts = new BigNumber(params.amount).times(1e8).toString(36);
        const isColumnA = params.isColumnA ? 1 : 0;
        const destinationAddr = params.destinationAddr.length > 42 ? `ref:${params.ref || 0}` : params.destinationAddr; // Handle long multisig addresses
        const payload = [propertyId, amounts, isColumnA, destinationAddr];
        const txNumber = 22;  // Transaction type 22
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 23: Encode Settle Channel PNL Transaction
    encodeSettleChannelPNL: (params) => {
        const payload = [
            params.txidNeutralized,
            params.contractId.toString(36),
            params.amountCancelled.toString(36),
            params.propertyId.toString(36),
            params.amountSettled.toString(36),
            params.close ? '1' : '0',
            params.propertyId2 ? params.propertyId2.toString(36) : '0',
            params.amountDelivered ? params.amountDelivered.toString(36) : '0',
        ];
        const txNumber = 23;  // Transaction type 23
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 24: Encode Mint Synthetic Transaction
    encodeMintSynthetic: (params) => {
        const payload = [
            params.propertyIdUsed.toString(36),
            params.contractIdUsed.toString(36),
            params.amount.toString(36),
        ];
        const txNumber = 24;  // Transaction type 24
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 25: Encode Redeem Synthetic Transaction
    encodeRedeemSynthetic: (params) => {
        const payload = [
            params.propertyIdUsed.toString(36),
            params.contractIdUsed.toString(36),
            params.amount.toString(36),
        ];
        const txNumber = 25;  // Transaction type 25
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 26: Encode Pay to Tokens Transaction
    encodePayToTokens: (params) => {
        const payload = [
            params.propertyIdTarget.toString(36),
            params.propertyIdUsed.toString(36),
            params.amount.toString(36),
        ];
        const txNumber = 26;  // Transaction type 26
        return marker + txNumber.toString(36) + payload.join(',');
    },

      // Transaction type 27: Encode Create Option Chain Transaction
    encodeCreateOptionChain: (params) => {
        const payload = [
            params.contractSeriesId.toString(36),
            params.strikePercentInterval.toString(36),
            params.europeanStyle ? '1' : '0',
        ];
        const txNumber = 27;  // Transaction type 27
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 28: Encode Trade Bai Urbun Transaction
    encodeTradeBaiUrbun: (params) => {
        const payload = [
            params.propertyIdDownPayment.toString(36),
            params.propertyIdToBeSold.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.expiryBlock.toString(36),
            params.tradeExpiryBlock.toString(36),
        ];
        const txNumber = 28;  // Transaction type 28
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 29: Encode Trade Murabaha Transaction
    encodeTradeMurabaha: (params) => {
        const payload = [
            params.propertyIdDownPayment.toString(36),
            params.downPaymentPercent.toString(36),
            params.propertyIdToBeSold.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.expiryBlock.toString(36),
            params.installmentInterval.toString(36),
            params.tradeExpiryBlock.toString(36),
        ];
        const txNumber = 29;  // Transaction type 29
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 30: Encode Issue Invoice Transaction
    encodeIssueInvoice: (params) => {
        const payload = [
            params.propertyIdToReceivePayment.toString(36),
            params.amount.toString(36),
            params.dueDateBlock.toString(36),
            params.optionalPropertyIdCollateral ? params.optionalPropertyIdCollateral.toString(36) : '0',
            params.receivesPayToToken ? '1' : '0',
        ];
        const txNumber = 30;  // Transaction type 30
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 31: Encode Batch Move Zk Rollup Transaction
    encodeBatchMoveZkRollup: (params) => {
        // Assuming params.payments is an array of payment objects
        const paymentsPayload = params.payments.map(payment => {
            const paymentDetails = [
                payment.fromAddress,
                payment.propertyIds.map(id => id.toString(36)).join(':'),
                payment.amounts.map(amt => amt.toString(36)).join(':'),
                payment.toAddress,
                payment.sentPropertyIds.map(id => id.toString(36)).join(':'),
                payment.sentAmounts.map(amt => amt.toString(36)).join(':'),
            ];
            return paymentDetails.join(',');
        }).join(';');
        const payload = [
            params.proof,
            paymentsPayload,
            JSON.stringify(params.miscLogic),
            JSON.stringify(params.miscData),
        ];
        const txNumber = 31;  // Transaction type 31
        return marker + txNumber.toString(36) + payload.join('|');
    },

    // Transaction type 32: Encode Publish New Transaction Type
    encodePublishNewTx: (params) => {
        const txNumber = 32;  // Transaction type 32
        return marker + txNumber.toString(36) + params.ordinalRevealJSON; // Assuming this is a JSON string
    },

    // Transaction type 33: Encode Create Derivative of LRC20 or RGB
    encodeColoredCoin: (params) => {
        const payload = [
            params.lrc20TokenSeriesId1.toString(36),
            params.lrc20TokenSeriesId2.toString(36),
            params.rgb ? '1' : '0',
        ];
        const txNumber = 33;  // Transaction type 33
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 34: Encode Register OP_CTV Covenant
    encodeRegisterOPCTVCovenant: (params) => {
        const payload = [
            params.redeem,
            params.txid,
            params.associatedPropertyId1 ? params.associatedPropertyId1.toString(36) : '0',
            params.associatedPropertyId2 ? params.associatedPropertyId2.toString(36) : '0',
            params.covenantType.toString(36),
        ];
        const txNumber = 34;  // Transaction type 34
        return marker + txNumber.toString(36) + payload.join(',');
    },

    // Transaction type 35: Encode Cross TL Chain Bridging Transaction
    encodeCrossLayerBridge: (params) => {
        const payload = [
            params.propertyId.toString(36),
            params.amount.toString(36),
            params.destinationAddr
        ];
        const txNumber = 35;  // Transaction type 35
        return marker + txNumber.toString(36) + payload.join(',');
    }

}

module.exports = Encode;
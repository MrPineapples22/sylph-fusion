import { VersionedMessage, VersionedTransaction } from '@solana/web3.js';
import { createHash, createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';
export const transactionHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function decodeSingleSignerMessage(bytes, signer) {
    const copy = Uint8Array.from(bytes);
    let message;
    try {
        message = VersionedMessage.deserialize(copy);
    }
    catch {
        throw new Error('TRANSACTION_MESSAGE_INVALID');
    }
    if (message.version !== 'legacy' && message.version !== 0)
        throw new Error('TRANSACTION_VERSION_UNSUPPORTED');
    if (!Buffer.from(message.serialize()).equals(Buffer.from(copy)))
        throw new Error('TRANSACTION_MESSAGE_ROUNDTRIP_MISMATCH');
    // Multiple-signature assembly needs its own reviewed gateway contract.
    if (message.header.numRequiredSignatures !== 1 || !message.staticAccountKeys[0]?.equals(signer)) {
        throw new Error('TRANSACTION_REQUIRED_SIGNER_MISMATCH');
    }
    const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = message.header;
    const staticCount = message.staticAccountKeys.length;
    if (numRequiredSignatures > staticCount || numReadonlySignedAccounts >= numRequiredSignatures ||
        numReadonlyUnsignedAccounts > staticCount - numRequiredSignatures) {
        throw new Error('TRANSACTION_HEADER_INVALID');
    }
    let loadedCount = 0;
    if (message.version === 0) {
        for (const lookup of message.addressTableLookups) {
            if (lookup.writableIndexes.length + lookup.readonlyIndexes.length === 0)
                throw new Error('TRANSACTION_LOOKUP_EMPTY');
            loadedCount += lookup.writableIndexes.length + lookup.readonlyIndexes.length;
        }
    }
    const accountCount = staticCount + loadedCount;
    if (accountCount > 256)
        throw new Error('TRANSACTION_ACCOUNT_COUNT_INVALID');
    for (const instruction of message.compiledInstructions) {
        // Program IDs must be static, and fee payer cannot be an invoked program.
        if (instruction.programIdIndex === 0 || instruction.programIdIndex >= staticCount ||
            instruction.accountKeyIndexes.some(index => index >= accountCount)) {
            throw new Error('TRANSACTION_INSTRUCTION_INDEX_INVALID');
        }
    }
    // Supported policy has exactly one signature: one shortvec byte + 64 signature bytes.
    if (copy.length + 65 > 1232)
        throw new Error('TRANSACTION_PACKET_TOO_LARGE');
    return message;
}
export function assembleVerifiedTransaction(messageBytes, signatureBytes, signer) {
    const message = decodeSingleSignerMessage(messageBytes, signer);
    const signature = Uint8Array.from(signatureBytes);
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), signer.toBuffer()]), format: 'der', type: 'spki' });
    if (signature.length !== 64 || !verify(null, message.serialize(), publicKey, signature))
        throw new Error('TRANSACTION_SIGNATURE_INVALID');
    const transaction = new VersionedTransaction(message);
    transaction.signatures = [signature];
    const wire = transaction.serialize();
    if (wire.length > 1232)
        throw new Error('TRANSACTION_PACKET_TOO_LARGE');
    const roundtrip = VersionedTransaction.deserialize(wire);
    if (!Buffer.from(roundtrip.serialize()).equals(Buffer.from(wire)) || !Buffer.from(roundtrip.message.serialize()).equals(Buffer.from(messageBytes))) {
        throw new Error('TRANSACTION_WIRE_ROUNDTRIP_MISMATCH');
    }
    return Object.freeze({ messageBase64: Buffer.from(messageBytes).toString('base64'), wireBase64: Buffer.from(wire).toString('base64'), messageHash: transactionHash(messageBytes), wireHash: transactionHash(wire), signature: bs58.encode(signature) });
}
//# sourceMappingURL=transaction-artifact.js.map
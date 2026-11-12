// Offline calculation only: no SSH, network or browser operation.
// Arguments are local before/after timestamps and remote timestamp, all epoch ms.
const [localBefore,remote,localAfter]=process.argv.slice(2).map(Number);
if(![localBefore,remote,localAfter].every(Number.isSafeInteger)||localBefore>localAfter)throw Error('Use LOCAL_BEFORE_MS REMOTE_MS LOCAL_AFTER_MS');
console.log(JSON.stringify({remoteMinusLocalLowerMs:remote-localAfter,remoteMinusLocalUpperMs:remote-localBefore,roundTripMs:localAfter-localBefore}));

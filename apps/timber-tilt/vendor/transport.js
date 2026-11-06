// The upstream loader's native log buffer is 2048 bytes. Each message below
// is ASCII and less than 1500 bytes including its newline and terminator.
var sendCivInputProReport = async function (report) {
    "use strict";
    var json = JSON.stringify(report).replace(/[^\x20-\x7e]/g, function (char) {
        return "\\u" + ("0000" + char.charCodeAt(0).toString(16)).slice(-4);
    });
    var hash = 2166136261;
    for (var i = 0; i < json.length; i++) {
        hash ^= json.charCodeAt(i);
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
    }
    var size = 1400, chunks = Math.ceil(json.length / size);
    await log("CIV_INPUT_PRO_REPORT_BEGIN:" + JSON.stringify({ chars: json.length, chunks: chunks, fnv1a: ("00000000" + hash.toString(16)).slice(-8) }));
    for (var index = 0; index < chunks; index++) await log("CIV_INPUT_PRO_CHUNK:" + index + ":" + json.slice(index * size, (index + 1) * size));
    await log("CIV_INPUT_PRO_REPORT_END:" + chunks);
};

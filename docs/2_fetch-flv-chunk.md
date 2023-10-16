# 2 - Fetch FLV Chunk

In this part, we will implement part of the most important `FlvPlayer.load()` process.

For learning step by step, this part will not include many media related operations. We will do the forehead process of `FlvPlayer.load()`, which mainly refers to fetching .flv stream and parsing FLV chunk's metadata.

## Detailed Explanation

When we call `FlvPlayer.load()`, we start a simple single-line chain: `FlvPlayer.load() => Transmuxer.open() => TransmuxingController.start() => IOController.open() => FetchStreamLoader.open()`

After calling `FetchStreamLoader.open()`, [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/fetch) will be used to request the FLV stream.

When data is read from the stream, it will be send to `IOController`, which holds a buffer and manages incoming data to be consumed or stashed for future consumption.

Real consumption is located in `TransmuxingController`, data will be set to `FLVDemuxer.parseChunks`, data that matches FLV chunk format will be consumed.

> Attention: currently, we don't actually consumed media data content, but only parse the metadata and log it in the console.

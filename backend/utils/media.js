const fs = require('fs');
const path = require('path');
const mime = require('mime');

class MessageMedia {
    constructor(mimetype, data, filename, filesize) {
        this.mimetype = mimetype;
        this.data = data;
        this.filename = filename;
        this.filesize = filesize;
    }

    static fromFilePath(filePath) {
        const buffer = fs.readFileSync(filePath);
        const mimetype = mime.getType(filePath) || 'application/octet-stream';
        return new MessageMedia(mimetype, buffer.toString('base64'), path.basename(filePath), buffer.length);
    }
}

module.exports = { MessageMedia };

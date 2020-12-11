const Jimp = require('jimp');
const QrCodeReader = require('qrcode-reader');

const imageFile = './i6ZXZ4-uiUU.jpg';
const resName = './detectQrCode.jpeg'

const [sx, sy] = [844, 60];
const [ex, ey] = [1138, 356];
const [ox, oy] = [8, 8];
const [w, h] = [64, 64];
const [rows, cols, rotz ] = [4, 4, 4];
const whiteWidth = 16;
const outState = false;
const writeImages = false;

const genCells = (image) => {
    const cells = [];

    image.crop(sx, sy, ex - sx, ey - sy);

    for (let r = 0; r < rows; r++) {
        const cy = oy + (oy + h) * r;

        for (let c = 0; c < cols; c++) {
            const cx = ox + (ox + w) * c;
            const cell = image.clone();

            cell.crop(cx, cy, w, h);
            cells.push(cell);
        }
    }

    return cells;
};

const cellLineCache = new WeakMap();

const getCellLine = (cell, num, width) => {
    const key = `${num}-${width}`;
    const cached = cellLineCache.get(cell) || {};
    let res;

    if (typeof cached[key] !== 'undefined') {
        res = cached[key];
    } else {
        const cloneCell = cell.clone();
        switch(num) {
        case 0: // left
            res = cloneCell.crop(0, 0, width, h);
            break;
        case 1: // right
            res = cloneCell.crop(w - width, 0, width, h);
            break;
        case 2: // up
            res = cloneCell.crop(0, 0, w, width);
            break;
        case 3: // down
            res = cloneCell.crop(0, h - width, w, width);
            break;
        }
    }
    cached[key] = res;
    cellLineCache.set(cell, cached);

    return res;
}

const vertWhiteLine = new Jimp(whiteWidth, h, '#FFFFFF');
const horizWhiteLine = new Jimp(w, whiteWidth, '#FFFFFF');

const rotateSquareImageClockwise = (image, rot) => {
    if (rot !== 0) {
        const bitmap = Buffer.alloc(image.bitmap.data.length);

        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
            let _x, _y, _idx;

            switch (rot) {
            case 1:
                _x = this.bitmap.width - 1 - y;
                _y = x;
                break;
            case 2:
                _x = this.bitmap.width - 1 - x;
                _y = this.bitmap.height - 1 - y;
                break;
            case 3:
                _x = y;
                _y = this.bitmap.height - 1 - x;
                break;
            }
            _idx = this.bitmap.width * _y + _x << 2;

            const data = this.bitmap.data.readUInt32BE(idx);
            bitmap.writeUInt32BE(data, _idx);
        });
        image.bitmap.data = Buffer.from(bitmap);
    }

    return image;
}

const transformCellCache = new WeakMap();

const transformCell = (cell, num) => {
    const cached = transformCellCache.get(cell) || {};

    let res;
    if (typeof cached[num] !== 'undefined') {
        res = cached[num];
    } else {
        res = rotateSquareImageClockwise(cell.clone(), num);
    }
    cached[num] = res;
    transformCellCache.set(cell, cached);

    return res;
};

const genImage = (cells, ndxs, rots) => {
    const newImage = new Jimp(ox * 2 + w * 4, oy * 2 + h * 4, '#000080');

    let ndx = 0;
    for (let r = 0; r < rows; r++) {
        const y = r * h;

        for (let c = 0; c < cols; c++) {
            const x = c * w;

            const ncell = ndxs[ndx];
            const rot = rots[ndx];
            if (typeof cells[ncell] !== 'undefined') {
                const cell = cells[ncell];
                const rotCell = transformCell(cell, rot);

                newImage.blit(rotCell, ox + x, oy + y);
            }
            ndx += 1;
        }
    }

    return newImage;
};

const checkImage = async (image) => {
    const value = await new Promise((res, rej) => {
        const qrCodeReader = new QrCodeReader();

        qrCodeReader.callback = (err, val) => (err ? rej(err) : res(val));
        qrCodeReader.decode(image.bitmap);
    });

    return value;
};

const checkState = async (cells, ndxs, rots) => {
    const image = genImage(cells, ndxs, rots);

    try {
        const value = await checkImage(image);

        await new Promise((res, rej) => {
            image.write(`${resName}`, (err, img) => (err ? rej(err) : res(img)));
        }) 

        // console.log('value', value);
        return value;
    } catch (e) {
        // console.log('error', e);
        return null;
    }
};

const isWhiteLine = (cell, num) => {
    const cellLine = getCellLine(cell, num, whiteWidth);
    let whiteLine;

    let isWhite;
    switch(num) {
    case 0: // left
    case 1: // right
        whiteLine = vertWhiteLine;
        break;
    case 2: // up
    case 3: // down
        whiteLine = horizWhiteLine;
        break;
    }

    const diff = Jimp.diff(cellLine, whiteLine); // pixel difference

    if (diff.percent > 0) {
        isWhite = false;
    } else {
        isWhite = true;
    }

    return isWhite;
};

const isSameLine = (prevCell, lastCell, prevNum, lastNum, width) => {
    let isSame;

    const prevImg = getCellLine(prevCell, prevNum, width); // right line
    const lastImg = getCellLine(lastCell, lastNum, width); // left line

    const diff = Jimp.diff(prevImg, lastImg); // pixel difference

    if (diff.percent > 0) {
        isSame = false;
    } else {
        isSame = true;
    }

    return isSame;
}

let imgNdx = 0;

const explore = async (cells, { possible, used, path, rots }) => {
    for (let ndx = 0; ndx < possible.length; ndx++) {
        let cellNum = possible[ndx];
        let state = {
            possible: possible.filter(num => num !== cellNum),
            used: [...used, cellNum],
            path: [...path, ndx]
        };

        for (let rot = 0; rot < rotz; rot++) {
            state = {
                ...state,
                rots: [...rots, rot]
            }

            /*
            if (state.used.length == 8) {
                continue;
            }
            */

            if (state.possible.length !== 0) {
                const lastPos = state.used.length - 1;

                const lastCol = lastPos % cols;
                const lastRow = (lastPos - lastCol) / cols;

                const lastCell = transformCell(cells[state.used[lastPos]], state.rots[lastPos]);

                let isGood = true;

                if (lastCol === 0 && !isWhiteLine(lastCell, 0)) { // left
                    isGood = false;
                }

                if (isGood && lastRow === 0 && !isWhiteLine(lastCell, 2)) { // up
                    isGood = false;
                }

                if (isGood && lastCol !== 0 && lastCol !== cols - 1) {
                    if (isGood && isWhiteLine(lastCell, 0)) { // left
                        isGood = false;
                    }
                    if (isGood && isWhiteLine(lastCell, 1)) { // right
                        isGood = false;
                    }
                }

                if (isGood && lastRow !== 0 && lastRow !== rows - 1) {
                    if (isGood && isWhiteLine(lastCell, 2)) { // up
                        isGood = false;
                    }
                    if (isGood && isWhiteLine(lastCell, 3)) { // down
                        isGood = false;
                    }
                }

                if (isGood && lastCol === cols - 1) {
                    if (isGood && !isWhiteLine(lastCell, 1)) { // right
                        isGood = false;
                    }
                }

                if (isGood && lastRow === rows - 1) {
                    if (isGood && !isWhiteLine(lastCell, 3)) { // down
                        isGood = false;
                    }
                }

                if (isGood && (lastRow > 0 || lastCol > 0)) {
                    if (isGood && lastCol > 0) {
                        const leftPos = lastPos - 1;

                        const leftCell = transformCell(cells[state.used[leftPos]], state.rots[leftPos]);

                        if (!isSameLine(leftCell, lastCell, 1, 0, 1)) { // right and left line
                            isGood = false;
                        }
                    }

                    if (isGood && lastRow > 0) {
                        const upPos = lastPos - cols;

                        const upCell = transformCell(cells[state.used[upPos]], state.rots[upPos]);

                        if (!isSameLine(upCell, lastCell, 3, 2, 1)) { // down and up line
                            isGood = false;
                        }
                    }
                }

                if (writeImages) {
                    const image = genImage(cells, state.used, state.rots);
                    const name = `0000${imgNdx}`.substring((`${imgNdx}`.length));

                    await new Promise((res, rej) => {
                        image.write(`./${name}.jpeg`, (err, img) => (err ? rej(err) : res(img)));
                    })
                    imgNdx += 1;
                }

                if (isGood) {
                    if (outState) {
                        console.log('state', JSON.stringify(state));
                    } else {
                        process.stdout.write('.');
                    }

                    await explore(cells, state);
                }
            } else {
                if (outState) {
                    console.log('state', JSON.stringify(state));
                }

                if (writeImages) {
                    const image = genImage(cells, state.used, state.rots);
                    const name = `0000${imgNdx}`.substring((`${imgNdx}`.length));

                    await new Promise((res, rej) => {
                        image.write(`./${name}.jpeg`, (err, img) => (err ? rej(err) : res(img)));
                    })
                    imgNdx += 1;
                }

                const res = await checkState(cells, state.used, state.rots);

                if (res) {
                    if (!outState) {
                        process.stdout.write('X');
                    }
                    console.log('\nres', res);

                    process.exit();
                } else {
                    if (!outState) {
                        process.stdout.write('#');
                    }
                }
            }
        }
    }
};

(async () => {
    const image = await new Promise((res, rej) => Jimp.read(imageFile, (err, img) => (err ? rej(err) : res(img))));
    const cells = genCells(image);

    await explore(cells, {
        cells,
        possible: cells.map((cell, ndx, all) => ndx),
        used: [],
        path: [],
        rots: []
    });
})();

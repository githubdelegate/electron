(function () {
var asar, asarStatsToFsStats, cachedArchives, child_process, fakeTime, getOrCreateArchive, gid, invalidArchiveError, nextInode, notDirError, notFoundError, overrideAPI, overrideAPISync, path, splitPath, uid, util,
  hasProp = {}.hasOwnProperty;

asar = process.binding('atom_common_asar');

child_process = require('child_process');

path = require('path');

util = require('util');


/* Cache asar archive objects. */

cachedArchives = {};

getOrCreateArchive = function(p) {
  var archive;
  archive = cachedArchives[p];
  if (archive != null) {
    return archive;
  }
  archive = asar.createArchive(p);
  if (!archive) {
    return false;
  }
  return cachedArchives[p] = archive;
};


/* Clean cache on quit. */

process.on('exit', function() {
  var archive, p, results;
  results = [];
  for (p in cachedArchives) {
    if (!hasProp.call(cachedArchives, p)) continue;
    archive = cachedArchives[p];
    results.push(archive.destroy());
  }
  return results;
});


/* Separate asar package's path from full path. */

splitPath = function(p) {

  /* shortcut to disable asar. */
  var index;
  if (process.noAsar) {
    return [false];
  }
  if (typeof p !== 'string') {
    return [false];
  }
  if (p.substr(-5) === '.asar') {
    return [true, p, ''];
  }
  p = path.normalize(p);
  index = p.lastIndexOf(".asar" + path.sep);
  if (index === -1) {
    return [false];
  }
  return [true, p.substr(0, index + 5), p.substr(index + 6)];
};


/* Convert asar archive's Stats object to fs's Stats object. */

nextInode = 0;

uid = process.getuid != null ? process.getuid() : 0;

gid = process.getgid != null ? process.getgid() : 0;

fakeTime = new Date();

asarStatsToFsStats = function(stats) {
  return {
    dev: 1,
    ino: ++nextInode,
    mode: 33188,
    nlink: 1,
    uid: uid,
    gid: gid,
    rdev: 0,
    atime: stats.atime || fakeTime,
    birthtime: stats.birthtime || fakeTime,
    mtime: stats.mtime || fakeTime,
    ctime: stats.ctime || fakeTime,
    size: stats.size,
    isFile: function() {
      return stats.isFile;
    },
    isDirectory: function() {
      return stats.isDirectory;
    },
    isSymbolicLink: function() {
      return stats.isLink;
    },
    isBlockDevice: function() {
      return false;
    },
    isCharacterDevice: function() {
      return false;
    },
    isFIFO: function() {
      return false;
    },
    isSocket: function() {
      return false;
    }
  };
};


/* Create a ENOENT error. */

notFoundError = function(asarPath, filePath, callback) {
  var error;
  error = new Error("ENOENT, " + filePath + " not found in " + asarPath);
  error.code = "ENOENT";
  error.errno = -2;
  if (typeof callback !== 'function') {
    throw error;
  }
  return process.nextTick(function() {
    return callback(error);
  });
};


/* Create a ENOTDIR error. */

notDirError = function(callback) {
  var error;
  error = new Error('ENOTDIR, not a directory');
  error.code = 'ENOTDIR';
  error.errno = -20;
  if (typeof callback !== 'function') {
    throw error;
  }
  return process.nextTick(function() {
    return callback(error);
  });
};


/* Create invalid archive error. */

invalidArchiveError = function(asarPath, callback) {
  var error;
  error = new Error("Invalid package " + asarPath);
  if (typeof callback !== 'function') {
    throw error;
  }
  return process.nextTick(function() {
    return callback(error);
  });
};


/* Override APIs that rely on passing file path instead of content to C++. */

overrideAPISync = function(module, name, arg) {
  var old;
  if (arg == null) {
    arg = 0;
  }
  old = module[name];
  return module[name] = function() {
    var archive, asarPath, filePath, isAsar, newPath, p, ref;
    p = arguments[arg];
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return old.apply(this, arguments);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      invalidArchiveError(asarPath);
    }
    newPath = archive.copyFileOut(filePath);
    if (!newPath) {
      notFoundError(asarPath, filePath);
    }
    arguments[arg] = newPath;
    return old.apply(this, arguments);
  };
};

overrideAPI = function(module, name, arg) {
  var old;
  if (arg == null) {
    arg = 0;
  }
  old = module[name];
  return module[name] = function() {
    var archive, asarPath, callback, filePath, isAsar, newPath, p, ref;
    p = arguments[arg];
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return old.apply(this, arguments);
    }
    callback = arguments[arguments.length - 1];
    if (typeof callback !== 'function') {
      return overrideAPISync(module, name, arg);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return invalidArchiveError(asarPath, callback);
    }
    newPath = archive.copyFileOut(filePath);
    if (!newPath) {
      return notFoundError(asarPath, filePath, callback);
    }
    arguments[arg] = newPath;
    return old.apply(this, arguments);
  };
};


/* Override fs APIs. */

exports.wrapFsWithAsar = function(fs) {
  var exists, existsSync, internalModuleReadFile, internalModuleStat, lstat, lstatSync, mkdir, mkdirSync, open, openSync, readFile, readFileSync, readdir, readdirSync, realpath, realpathSync, stat, statSync, statSyncNoException;
  lstatSync = fs.lstatSync;
  fs.lstatSync = function(p) {
    var archive, asarPath, filePath, isAsar, ref, stats;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return lstatSync(p);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      invalidArchiveError(asarPath);
    }
    stats = archive.stat(filePath);
    if (!stats) {
      notFoundError(asarPath, filePath);
    }
    return asarStatsToFsStats(stats);
  };
  lstat = fs.lstat;
  fs.lstat = function(p, callback) {
    var archive, asarPath, filePath, isAsar, ref, stats;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return lstat(p, callback);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return invalidArchiveError(asarPath, callback);
    }
    stats = getOrCreateArchive(asarPath).stat(filePath);
    if (!stats) {
      return notFoundError(asarPath, filePath, callback);
    }
    return process.nextTick(function() {
      return callback(null, asarStatsToFsStats(stats));
    });
  };
  statSync = fs.statSync;
  fs.statSync = function(p) {
    var asarPath, filePath, isAsar, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return statSync(p);
    }

    /* Do not distinguish links for now. */
    return fs.lstatSync(p);
  };
  stat = fs.stat;
  fs.stat = function(p, callback) {
    var asarPath, filePath, isAsar, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return stat(p, callback);
    }

    /* Do not distinguish links for now. */
    return process.nextTick(function() {
      return fs.lstat(p, callback);
    });
  };
  statSyncNoException = fs.statSyncNoException;
  fs.statSyncNoException = function(p) {
    var archive, asarPath, filePath, isAsar, ref, stats;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return statSyncNoException(p);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return false;
    }
    stats = archive.stat(filePath);
    if (!stats) {
      return false;
    }
    return asarStatsToFsStats(stats);
  };
  realpathSync = fs.realpathSync;
  fs.realpathSync = function(p) {
    var archive, asarPath, filePath, isAsar, real, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return realpathSync.apply(this, arguments);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      invalidArchiveError(asarPath);
    }
    real = archive.realpath(filePath);
    if (real === false) {
      notFoundError(asarPath, filePath);
    }
    return path.join(realpathSync(asarPath), real);
  };
  realpath = fs.realpath;
  fs.realpath = function(p, cache, callback) {
    var archive, asarPath, filePath, isAsar, real, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return realpath.apply(this, arguments);
    }
    if (typeof cache === 'function') {
      callback = cache;
      cache = void 0;
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return invalidArchiveError(asarPath, callback);
    }
    real = archive.realpath(filePath);
    if (real === false) {
      return notFoundError(asarPath, filePath, callback);
    }
    return realpath(asarPath, function(err, p) {
      if (err) {
        return callback(err);
      }
      return callback(null, path.join(p, real));
    });
  };
  exists = fs.exists;
  fs.exists = function(p, callback) {
    var archive, asarPath, filePath, isAsar, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return exists(p, callback);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return invalidArchiveError(asarPath, callback);
    }
    return process.nextTick(function() {
      return callback(archive.stat(filePath) !== false);
    });
  };
  existsSync = fs.existsSync;
  fs.existsSync = function(p) {
    var archive, asarPath, filePath, isAsar, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return existsSync(p);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return false;
    }
    return archive.stat(filePath) !== false;
  };
  open = fs.open;
  readFile = fs.readFile;
  fs.readFile = function(p, options, callback) {
    var archive, asarPath, buffer, encoding, fd, filePath, info, isAsar, realPath, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return readFile.apply(this, arguments);
    }
    if (typeof options === 'function') {
      callback = options;
      options = void 0;
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return invalidArchiveError(asarPath, callback);
    }
    info = archive.getFileInfo(filePath);
    if (!info) {
      return notFoundError(asarPath, filePath, callback);
    }
    if (info.size === 0) {
      return process.nextTick(function() {
        return callback(null, new Buffer(0));
      });
    }
    if (info.unpacked) {
      realPath = archive.copyFileOut(filePath);
      return fs.readFile(realPath, options, callback);
    }
    if (!options) {
      options = {
        encoding: null
      };
    } else if (util.isString(options)) {
      options = {
        encoding: options
      };
    } else if (!util.isObject(options)) {
      throw new TypeError('Bad arguments');
    }
    encoding = options.encoding;
    buffer = new Buffer(info.size);
    fd = archive.getFd();
    if (!(fd >= 0)) {
      return notFoundError(asarPath, filePath, callback);
    }
    return fs.read(fd, buffer, 0, info.size, info.offset, function(error) {
      return callback(error, encoding ? buffer.toString(encoding) : buffer);
    });
  };
  openSync = fs.openSync;
  readFileSync = fs.readFileSync;
  fs.readFileSync = function(p, opts) {

    /* this allows v8 to optimize this function */
    var archive, asarPath, buffer, encoding, fd, filePath, info, isAsar, options, realPath, ref;
    options = opts;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return readFileSync.apply(this, arguments);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      invalidArchiveError(asarPath);
    }
    info = archive.getFileInfo(filePath);
    if (!info) {
      notFoundError(asarPath, filePath);
    }
    if (info.size === 0) {
      if (options) {
        return '';
      } else {
        return new Buffer(0);
      }
    }
    if (info.unpacked) {
      realPath = archive.copyFileOut(filePath);
      return fs.readFileSync(realPath, options);
    }
    if (!options) {
      options = {
        encoding: null
      };
    } else if (util.isString(options)) {
      options = {
        encoding: options
      };
    } else if (!util.isObject(options)) {
      throw new TypeError('Bad arguments');
    }
    encoding = options.encoding;
    buffer = new Buffer(info.size);
    fd = archive.getFd();
    if (!(fd >= 0)) {
      notFoundError(asarPath, filePath);
    }
    fs.readSync(fd, buffer, 0, info.size, info.offset);
    if (encoding) {
      return buffer.toString(encoding);
    } else {
      return buffer;
    }
  };
  readdir = fs.readdir;
  fs.readdir = function(p, callback) {
    var archive, asarPath, filePath, files, isAsar, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return readdir.apply(this, arguments);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return invalidArchiveError(asarPath, callback);
    }
    files = archive.readdir(filePath);
    if (!files) {
      return notFoundError(asarPath, filePath, callback);
    }
    return process.nextTick(function() {
      return callback(null, files);
    });
  };
  readdirSync = fs.readdirSync;
  fs.readdirSync = function(p) {
    var archive, asarPath, filePath, files, isAsar, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return readdirSync.apply(this, arguments);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      invalidArchiveError(asarPath);
    }
    files = archive.readdir(filePath);
    if (!files) {
      notFoundError(asarPath, filePath);
    }
    return files;
  };
  internalModuleReadFile = process.binding('fs').internalModuleReadFile;
  process.binding('fs').internalModuleReadFile = function(p) {
    var archive, asarPath, buffer, fd, filePath, info, isAsar, realPath, ref;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return internalModuleReadFile(p);
    }
    archive = getOrCreateArchive(asarPath);
    if (!archive) {
      return void 0;
    }
    info = archive.getFileInfo(filePath);
    if (!info) {
      return void 0;
    }
    if (info.size === 0) {
      return '';
    }
    if (info.unpacked) {
      realPath = archive.copyFileOut(filePath);
      return fs.readFileSync(realPath, {
        encoding: 'utf8'
      });
    }
    buffer = new Buffer(info.size);
    fd = archive.getFd();
    if (!(fd >= 0)) {
      return void 0;
    }
    fs.readSync(fd, buffer, 0, info.size, info.offset);
    return buffer.toString('utf8');
  };
  internalModuleStat = process.binding('fs').internalModuleStat;
  process.binding('fs').internalModuleStat = function(p) {
    var archive, asarPath, filePath, isAsar, ref, stats;
    ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
    if (!isAsar) {
      return internalModuleStat(p);
    }
    archive = getOrCreateArchive(asarPath);

    /* -ENOENT */
    if (!archive) {
      return -34;
    }
    stats = archive.stat(filePath);

    /* -ENOENT */
    if (!stats) {
      return -34;
    }
    if (stats.isDirectory) {
      return 1;
    } else {
      return 0;
    }
  };

  /*
    Calling mkdir for directory inside asar archive should throw ENOTDIR
    error, but on Windows it throws ENOENT.
    This is to work around the recursive looping bug of mkdirp since it is
    widely used.
   */
  if (process.platform === 'win32') {
    mkdir = fs.mkdir;
    fs.mkdir = function(p, mode, callback) {
      var asarPath, filePath, isAsar, ref;
      if (typeof mode === 'function') {
        callback = mode;
      }
      ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
      if (isAsar && filePath.length) {
        return notDirError(callback);
      }
      return mkdir(p, mode, callback);
    };
    mkdirSync = fs.mkdirSync;
    fs.mkdirSync = function(p, mode) {
      var asarPath, filePath, isAsar, ref;
      ref = splitPath(p), isAsar = ref[0], asarPath = ref[1], filePath = ref[2];
      if (isAsar && filePath.length) {
        notDirError();
      }
      return mkdirSync(p, mode);
    };
  }
  overrideAPI(fs, 'open');
  overrideAPI(child_process, 'execFile');
  overrideAPISync(process, 'dlopen', 1);
  overrideAPISync(require('module')._extensions, '.node', 1);
  overrideAPISync(fs, 'openSync');
  return overrideAPISync(child_process, 'execFileSync');
};
})()

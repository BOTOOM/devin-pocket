## [0.9.0](https://github.com/BOTOOM/devin-pocket/compare/v0.8.0...v0.9.0) (2026-11-14)

### Features

* **dictation:** add private on-device bilingual voice input ([784f5cb](https://github.com/BOTOOM/devin-pocket/commit/784f5cb11cf0ce5cdbf4c85938b2ec0ee867a22d))

### Bug Fixes

* **dictation:** discard native speech unless recording is stopped ([c62bd88](https://github.com/BOTOOM/devin-pocket/commit/c62bd88be1b62dd19fe57f1959a3fb633fdf9024))
* **dictation:** keep browser inference out of runtime dependencies ([1e5aa1f](https://github.com/BOTOOM/devin-pocket/commit/1e5aa1f3d6119aaa99438ec4cd99fc78139efde6))
* **dictation:** narrow ONNX asset path for strict type checking ([cfa489a](https://github.com/BOTOOM/devin-pocket/commit/cfa489a5515f879f0d3e2ae105f2a5c6adae0d51))
* **dictation:** preserve consecutive transcript insertions ([f678714](https://github.com/BOTOOM/devin-pocket/commit/f678714065ddf9063a9e32daad7df978e7e594bd))
* **dictation:** serve local ONNX assets during development ([2967772](https://github.com/BOTOOM/devin-pocket/commit/2967772ddca173a14fa9e9fb8ef3233ca6382b07))

## [0.8.0](https://github.com/BOTOOM/devin-pocket/compare/v0.7.0...v0.8.0) (2026-11-14)

### Features

* **ui:** give the composer a full-width input with an action row ([b1e3f26](https://github.com/BOTOOM/devin-pocket/commit/b1e3f266e04f3685bbcef8544f4f2b5b6bd87ff4))

## [0.7.0](https://github.com/BOTOOM/devin-pocket/compare/v0.6.0...v0.7.0) (2026-11-13)

### Features

* **auth:** add browser pairing and device management ([56dbc26](https://github.com/BOTOOM/devin-pocket/commit/56dbc2650991130154e5e6a0287dd6ca277922ec))
* **auth:** protect network access with QR device pairing ([396f870](https://github.com/BOTOOM/devin-pocket/commit/396f87058642684eea23a49f77dc2976e4991a06))

### Bug Fixes

* **auth:** discover IPv6 pairing addresses for IPv6 listeners ([c10049c](https://github.com/BOTOOM/devin-pocket/commit/c10049cfc528593c5c3ccd3acbb9351a08f3cd71))
* **auth:** use bound port for ephemeral startup pairing ([9a70b56](https://github.com/BOTOOM/devin-pocket/commit/9a70b560ac18fc53d47ac0b6771530639ebe19bb))
* **installer:** install Node 26 LTS and upgrade Node <24 to 24 ([8ba876c](https://github.com/BOTOOM/devin-pocket/commit/8ba876c55de895bb9117304ce5b1270233778b44))
* **installer:** retain supported Node when optional upgrades fail ([1fd71bd](https://github.com/BOTOOM/devin-pocket/commit/1fd71bdcaf11b760366d33a477b81abfb360f448))

## [0.6.0](https://github.com/BOTOOM/devin-pocket/compare/v0.5.0...v0.6.0) (2026-11-12)

### Features

* **cli:** add update command and new-version notice ([d681aba](https://github.com/BOTOOM/devin-pocket/commit/d681aba882923b234763ddd9eb4b7946071d7991))
* **installer:** add devin-pocket command on Termux host ([c7c210b](https://github.com/BOTOOM/devin-pocket/commit/c7c210b55def485283db7357e0c235fa9970cc94))
* **windows:** experimental native Windows support ([6f74fac](https://github.com/BOTOOM/devin-pocket/commit/6f74fac6558ea1a6415faf0b1684a249a513ea2f))

### Bug Fixes

* **cli:** avoid daemonizing foreground servers after updates ([a242e40](https://github.com/BOTOOM/devin-pocket/commit/a242e40a794e03b5f4d2053082650e2969028cf6))
* **cli:** persist an absolute startup working directory ([d36876e](https://github.com/BOTOOM/devin-pocket/commit/d36876e17d338282889a2861e978f47d4832889a))
* **cli:** skip non-executable POSIX command candidates ([066f72b](https://github.com/BOTOOM/devin-pocket/commit/066f72be577bfe4e8af1493836a1d8f0ffbbb576))
* **i18n:** translate Pocket update diagnostics in Spanish ([c075011](https://github.com/BOTOOM/devin-pocket/commit/c075011dfd9821f58a36a6bff1f33cdb96498b0d))
* **paths:** canonicalize macOS workspace test roots ([af70a34](https://github.com/BOTOOM/devin-pocket/commit/af70a34f7b7af0c277fe6c0569cf184612571cd2))
* **termux:** make installer fixtures portable to macOS ([38a2cc3](https://github.com/BOTOOM/devin-pocket/commit/38a2cc3e7d13fbfcfc1e7ff4755b649550b68c53))
* **web:** show manual updates for unknown installations ([2b94aaf](https://github.com/BOTOOM/devin-pocket/commit/2b94aafcf3b9aab698c64718c16a9b078b8c5518))
* **windows:** handle native folder paths in the client ([69e367c](https://github.com/BOTOOM/devin-pocket/commit/69e367c927c5500cee282ccba0c8b66fae7f6e08))
* **windows:** load packaged server through a file URL ([a772798](https://github.com/BOTOOM/devin-pocket/commit/a7727981afef64b39c74c44bfcf5b66498bbd336))
* **windows:** preserve LF line endings in native checkouts ([1b5f22b](https://github.com/BOTOOM/devin-pocket/commit/1b5f22b4e7f7bd8952fa4621a7cbd5ef8e38ae03))

## [0.5.0](https://github.com/BOTOOM/devin-pocket/compare/v0.4.0...v0.5.0) (2026-11-12)

### Features

* **sessions:** choose a working folder before creating a session ([ec0ac21](https://github.com/BOTOOM/devin-pocket/commit/ec0ac215993ecc62c48d8e3800118cadbe2e1e11))

### Bug Fixes

* **server:** validate session folders with realpath containment ([6877967](https://github.com/BOTOOM/devin-pocket/commit/687796752a240338f7aaf3d9d14ce393a5a6155a))
* **ui:** browse from the selected session folder ([39fc1d5](https://github.com/BOTOOM/devin-pocket/commit/39fc1d50f4bb88ca7caf87777b5f90bcf5f993e8))

## [0.4.0](https://github.com/BOTOOM/devin-pocket/compare/v0.3.0...v0.4.0) (2026-11-12)

### Features

* **ui:** adapt the client for tablets and desktop ([7f805dd](https://github.com/BOTOOM/devin-pocket/commit/7f805ddfaa1a01a6c599a4d76ce6324b28dd7cd0))

### Bug Fixes

* **sessions:** deduplicate creation requests by working folder ([50e9440](https://github.com/BOTOOM/devin-pocket/commit/50e9440a77c8fbfe3a092bedeb92d401263a995d))
* **ui:** isolate chat drafts when switching sessions ([97e7663](https://github.com/BOTOOM/devin-pocket/commit/97e7663dfd4599abfca02f9fa24b88fd0a521afb))
* **ui:** return home after deleting the active sidebar session ([e047418](https://github.com/BOTOOM/devin-pocket/commit/e047418a0b28de15326489d26c950255a240c27a))
* **ui:** share the in-flight session creation request ([cb77f0e](https://github.com/BOTOOM/devin-pocket/commit/cb77f0eee4df40d4d0b468d6a71a08291d6d121e))

### Maintenance

* normalize npm repository URL ([0984853](https://github.com/BOTOOM/devin-pocket/commit/098485389ca1d60430432c06847624a5c6a7ddf1))

## [0.3.0](https://github.com/BOTOOM/devin-pocket/compare/v0.2.1...v0.3.0) (2026-11-11)

### Features

* **ui:** adopt hex-phone branding and accessible light and dark themes ([f78065b](https://github.com/BOTOOM/devin-pocket/commit/f78065bb741e5ec4175ba794b9c19923c01a5947))
* **ui:** relative cost bar in model picker ([e77560d](https://github.com/BOTOOM/devin-pocket/commit/e77560de2a07c7e185768259531dda754f2a73a3))
* **ui:** soften light accent to pale mint ([d545e8c](https://github.com/BOTOOM/devin-pocket/commit/d545e8c80d361039e8f9d287dd1b8fecfb9423c7))

### Documentation

* **readme:** link the official website ([c139f20](https://github.com/BOTOOM/devin-pocket/commit/c139f2082dd447e4767f7dbdb3f2636aabac7483))

## [0.2.1](https://github.com/BOTOOM/devin-pocket/compare/v0.2.0...v0.2.1) (2026-11-11)

### Bug Fixes

* **release:** use changelog preset compatible with bundled notes generator ([8d663c5](https://github.com/BOTOOM/devin-pocket/commit/8d663c56cf3fa619743675a1d553f49257383196))

### Documentation

* **readme:** clarify CI exclusions and README patch releases ([b258f5d](https://github.com/BOTOOM/devin-pocket/commit/b258f5dfb0a87bbe34ac8ff9751146aadfb65df2))
* **readme:** publish complete bilingual npm documentation and improve discovery ([d3e818d](https://github.com/BOTOOM/devin-pocket/commit/d3e818d99da35651f8a3619de95d304d9d9cc559))

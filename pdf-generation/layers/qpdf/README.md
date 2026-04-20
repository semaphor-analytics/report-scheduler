This Lambda layer packages `qpdf` and its shared libraries under `/opt/bin` and
`/opt/lib` during `sam build --use-container`.

The scheduler resolves the binary in this order:

1. `QPDF_BIN`
2. `/opt/bin/qpdf`
3. `qpdf` from `PATH`

In production and `sam local invoke`, the intended path is `/opt/bin/qpdf`.
For the local Node-based harness (`npm run local:function-url`), install `qpdf`
on the host and optionally set `QPDF_BIN`.

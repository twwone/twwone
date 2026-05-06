#!/bin/bash
export PATH="/Users/wengtangyong/.nvm/versions/node/v24.15.0/bin:$PATH"
exec /Users/wengtangyong/.nvm/versions/node/v24.15.0/bin/serve \
  -s /Users/wengtangyong/StockApp/dist \
  -l 3100

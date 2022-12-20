FROM mcr.microsoft.com/vscode/devcontainers/typescript-node

ARG MONGO_TOOLS_VERSION=5.0
RUN curl -sSL "https://www.mongodb.org/static/pgp/server-${MONGO_TOOLS_VERSION}.asc" | gpg --dearmor > /usr/share/keyrings/mongodb-archive-keyring.gpg \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/mongodb-archive-keyring.gpg] http://repo.mongodb.org/apt/debian $(lsb_release -cs)/mongodb-org/${MONGO_TOOLS_VERSION} main" | tee /etc/apt/sources.list.d/mongodb-org-${MONGO_TOOLS_VERSION}.list \
        && apt-get update && export DEBIAN_FRONTEND=noninteractive \
        && apt-get install -y mongodb-database-tools mongodb-mongosh

RUN export DEBIAN_FRONTEND=noninteractive && apt-get install -y make build-essential libssl-dev zlib1g-dev \
        libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
        libncurses5-dev libncursesw5-dev xz-utils tk-dev

RUN wget https://www.python.org/ftp/python/3.8.4/Python-3.8.4.tgz && \
        tar xvf Python-3.8.4.tgz && \
        cd Python-3.8.4 && \
        ./configure --enable-optimizations --with-ensurepip=install && \
        make -j 8 && \
        make altinstall && \
        apt-get clean -y && rm -rf /var/lib/apt/lists/*
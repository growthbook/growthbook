#environment setup
echo "export PATH=\"$PATH:$HOME/.poetry/bin\"" >> ~/.bashrc
echo "printf 'Welcome to GrowthBook, to get started run:\n"yarn dev"\n'" >> ~/.bashrc

#poetry installation
curl -sSL https://install.python-poetry.org | python3.8 -

#needed for 'poetry install' during 'yarn setup'
export PATH="$PATH:$HOME/.poetry/bin"

yarn
yarn setup

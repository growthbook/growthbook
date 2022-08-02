#environment setup
sudo chmod -R a+rwx /etc/bash.bashrc
echo "export PATH=\"/home/node/.cache/pypoetry/virtualenvs/gbstats-vabhrsvx-py3.7/bin:$PATH:$HOME/.poetry/bin\"" >> /etc/bash.bashrc

#poetry installation
curl -sSL https://raw.githubusercontent.com/python-poetry/poetry/master/get-poetry.py | python3 -

#needed for the current shell session
export PATH="/home/node/.cache/pypoetry/virtualenvs/gbstats-vabhrsvx-py3.7/bin:$PATH:$HOME/.poetry/bin"

sudo chmod -R a+rwx /workspace
yarn
yarn setup
yarn dev
# docker related
echo "\n\nsudo apt-get update"
sudo apt-get update
# echo "\n\nsudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin"
# sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin
# echo "\n\ncurl -fsSL https://get.docker.com | sh"
# curl -fsSL https://get.docker.com | sh
# echo "\n\ndocker run -d -p 27017:27017 --name mongo \
#   -e MONGO_INITDB_ROOT_USERNAME=root \
#   -e MONGO_INITDB_ROOT_PASSWORD=password \
#   mongo"
# docker run -d -p 27017:27017 --name mongo \
#   -e MONGO_INITDB_ROOT_USERNAME=root \
#   -e MONGO_INITDB_ROOT_PASSWORD=password \
#   mongo

#mongo related
wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | sudo apt-key add -
echo "deb http://repo.mongodb.org/apt/debian buster/mongodb-org/5.0 main" | sudo tee /etc/apt/sources.list.d/mongodb-org-5.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# python
# echo "\n\ncurl -sSL https://install.python-poetry.org | python3 -"
# curl -sSL https://install.python-poetry.org | python3 -
# echo "\n\napt install python3.7.3-venv"
# apt install python3.7.3-venv
# echo "\n\npoetry -v"
# poetry -v

#yarn related
# echo "\n\nyarn"
# yarn
# echo "\n\nyarn setup"
# yarn setup
# echo "yarn dev"
# yarn dev
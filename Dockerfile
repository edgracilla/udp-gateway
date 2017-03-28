FROM node:boron

MAINTAINER Reekoh

RUN apt-get update && apt-get install -y build-essential

RUN mkdir -p /home/node/udp-gateway
COPY . /home/node/udp-gateway

WORKDIR /home/node/udp-gateway

# Install dependencies
RUN npm install pm2 yarn -g
RUN yarn install

EXPOSE 8080
CMD ["pm2-docker", "--json", "app.yml"]
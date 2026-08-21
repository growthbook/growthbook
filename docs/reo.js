const clientID = "123409b1f7b05ac";
const script = document.createElement("script");
script.src = "https://static.reo.dev/" + clientID + "/reo.js";
script.defer = true;
script.onload = function () {
  window.Reo.init({
    clientID: clientID,
    enableThirdPartyTracking: true,
  });
};
document.head.appendChild(script);

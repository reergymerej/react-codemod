import React from "react";
const { DOM } = React.DOM;
// const { div } = React.DOM;
const Test = () => {
  // return div({ className: "hey" }, "text");
  return DOM.div({ className: "hey" }, "text");
};

export default Test;

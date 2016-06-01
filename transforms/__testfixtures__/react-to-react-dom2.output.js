import React from 'react';

import ReactDOM from 'react-dom';

class Foo extends React.Component {
  randomMethod() {
    ReactDOM.findDOMNode(this.refs.foo).style.display = 'none';
  }

  render() {
    return <div ref="foo" onClick={this.randomMethod}>foo</div>;
  }
}

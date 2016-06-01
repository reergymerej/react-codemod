import React from 'react';

class Foo extends React.Component {
  randomMethod() {
    React.findDOMNode(this.refs.foo).style.display = 'none';
  }

  render() {
    return <div ref="foo" onClick={this.randomMethod}>foo</div>;
  }
}

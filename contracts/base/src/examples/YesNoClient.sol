// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAiOracle, IAiOracleClient} from "../IAiOracle.sol";

contract YesNoClient is IAiOracleClient {
    IAiOracle public immutable oracle;

    event Answered(uint256 indexed id, uint8 answer);

    error OnlyOracle();

    constructor(IAiOracle oracle_) {
        oracle = oracle_;
    }

    function ask(string calldata question) external payable returns (uint256) {
        return oracle.ask{value: msg.value}(question);
    }

    function onAnswer(uint256 id, uint8 answer) external {
        if (msg.sender != address(oracle)) revert OnlyOracle();
        emit Answered(id, answer);
    }
}

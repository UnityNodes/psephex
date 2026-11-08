// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

uint256 constant MAX_QUESTION_BYTES = 2000;

interface IAiOracle {
    enum Answer {
        UNKNOWN,
        YES,
        NO
    }

    struct Request {
        address requester;
        bytes32 questionHash;
        bool fulfilled;
    }

    event Asked(uint256 indexed id, address indexed requester, string question, bytes32 questionHash, uint256 paid);
    event Fulfilled(uint256 indexed id, uint8 answer);
    event CallbackFailed(uint256 indexed id);
    event OracleUpdated(address indexed previousOracle, address indexed newOracle);
    event CallbackGasLimitUpdated(uint256 previousLimit, uint256 newLimit);
    event FeeUpdated(uint256 previousFee, uint256 newFee);

    function ask(string calldata question) external payable returns (uint256 id);
    function fulfill(uint256 id, uint8 answer, bytes32 questionHash) external;
    function getRequest(uint256 id) external view returns (Request memory);
    function oracle() external view returns (address);
    function lastId() external view returns (uint256);
    function fee() external view returns (uint256);
}

interface IAiOracleClient {
    function onAnswer(uint256 id, uint8 answer) external;
}
